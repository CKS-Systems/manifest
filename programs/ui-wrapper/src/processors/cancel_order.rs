use std::{
    cell::{Ref, RefMut},
    collections::HashSet,
    mem::size_of,
};

use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::{
    get_helper, get_mut_helper, trace, DataIndex, FreeList, HyperTreeReadOperations,
    HyperTreeValueIteratorTrait, HyperTreeWriteOperations, RBNode, NIL,
};
use manifest::{
    program::{
        batch_update::{BatchUpdateParams, BatchUpdateReturn, CancelOrderParams, PlaceOrderParams},
        batch_update_instruction, deposit_instruction, get_dynamic_account,
        get_mut_dynamic_account, ManifestInstruction,
    },
    quantities::{BaseAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{DynamicAccount, MarketFixed, OrderType, NO_EXPIRATION_LAST_VALID_SLOT},
    validation::{ManifestAccountInfo, Program, Signer},
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
    program_error::ProgramError,
    pubkey::Pubkey,
    system_program,
};

use crate::{
    market_info::MarketInfo,
    open_order::{self, WrapperOpenOrder},
    processors::shared::OpenOrdersTreeReadOnly,
    wrapper_state::ManifestWrapperStateFixed,
};

use super::shared::{
    check_signer, expand_wrapper_if_needed, get_market_info_index_for_market, sync_fast,
    OpenOrdersTree, UnusedWrapperFreeListPadding, WrapperStateAccountInfo,
    EXPECTED_ORDER_BATCH_SIZE,
};

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct WrapperCancelOrderParams {
    client_order_id: u64,
}
impl WrapperCancelOrderParams {
    pub fn new(client_order_id: u64) -> Self {
        WrapperCancelOrderParams { client_order_id }
    }
}

pub(crate) fn process_cancel_order(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    let owner: Signer = Signer::new(next_account_info(account_iter)?)?;
    let trader_token_account: &AccountInfo = next_account_info(account_iter)?;
    let market: ManifestAccountInfo<MarketFixed> =
        ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
    let vault: &AccountInfo = next_account_info(account_iter)?;
    let mint: &AccountInfo = next_account_info(account_iter)?;
    let system_program: Program =
        Program::new(next_account_info(account_iter)?, &system_program::id())?;
    let token_program: &AccountInfo = next_account_info(account_iter)?;
    let manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id())?;

    check_signer(&wrapper_state, owner.key);
    let market_info_index: DataIndex = get_market_info_index_for_market(&wrapper_state, market.key);

    let cancel = WrapperCancelOrderParams::try_from_slice(data)?;

    // prepare cancel
    let wrapper_data: Ref<&mut [u8]> = wrapper_state.info.try_borrow_data()?;
    let wrapper: DynamicAccount<&ManifestWrapperStateFixed, &[u8]> =
        get_dynamic_account(&wrapper_data);

    let market_info: MarketInfo =
        *get_helper::<RBNode<MarketInfo>>(wrapper.dynamic, market_info_index).get_value();
    let trader_index: DataIndex = market_info.trader_index;
    let orders_root_index = market_info.orders_root_index;

    let open_orders_tree: OpenOrdersTreeReadOnly =
        OpenOrdersTreeReadOnly::new(wrapper.dynamic, orders_root_index, NIL);

    // find order with same client order id
    let (wrapper_index, open_order): (DataIndex, &WrapperOpenOrder) = open_orders_tree
        .iter::<WrapperOpenOrder>()
        .find(|(_, o)| o.get_client_order_id() == cancel.client_order_id)
        .ok_or(ProgramError::InvalidArgument)?;

    let core_cancel = CancelOrderParams::new_with_hint(
        open_order.get_order_sequence_number(),
        Some(open_order.get_market_data_index()),
    );
    trace!("cancel index:{wrapper_index} order:{open_order:?} cpi:{core_cancel:?}");
    drop(wrapper_data);

    invoke(
        &batch_update_instruction(
            market.key,
            owner.key,
            Some(trader_index),
            vec![core_cancel],
            vec![],
            None,
            None,
            None,
            None,
        ),
        &[
            owner.info.clone(),
            system_program.info.clone(),
            manifest_program.info.clone(),
            owner.info.clone(),
            market.info.clone(),
            trader_token_account.clone(),
            vault.clone(),
            token_program.clone(),
            mint.clone(),
        ],
    )?;

    // Process the order result

    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state.info.try_borrow_mut_data().unwrap();
    let wrapper: DynamicAccount<&mut ManifestWrapperStateFixed, &mut [u8]> =
        get_mut_dynamic_account(&mut wrapper_data);

    // fetch current root first to not borrow wrapper.dynamic twice
    let orders_root_index = {
        let market_info: &mut MarketInfo =
            get_mut_helper::<RBNode<MarketInfo>>(wrapper.dynamic, market_info_index)
                .get_mut_value();
        market_info.orders_root_index
    };

    // remove nodes from order tree
    let orders_root_index = {
        let mut open_orders_tree: OpenOrdersTree =
            OpenOrdersTree::new(wrapper.dynamic, orders_root_index, NIL);
        open_orders_tree.remove_by_index(wrapper_index);
        open_orders_tree.get_root_index()
    };

    // save new root
    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(wrapper.dynamic, market_info_index).get_mut_value();
    market_info.orders_root_index = orders_root_index;

    // add nodes to freelist
    let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
        FreeList::new(wrapper.dynamic, wrapper.fixed.free_list_head_index);

    if wrapper_index != NIL {
        free_list.add(wrapper_index);
    }

    wrapper.fixed.free_list_head_index = free_list.get_head();

    Ok(())
}
