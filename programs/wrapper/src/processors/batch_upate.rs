use std::{
    cell::{Ref, RefMut},
    collections::HashSet,
    mem::size_of,
};

use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::{
    get_helper, get_mut_helper, DataIndex, FreeList, HyperTreeReadOperations,
    HyperTreeValueIteratorTrait, HyperTreeWriteOperations, RBNode, NIL,
};
use manifest::{
    program::{
        batch_update::{BatchUpdateParams, BatchUpdateReturn, CancelOrderParams, PlaceOrderParams},
        get_dynamic_account, get_mut_dynamic_account, ManifestInstruction,
    },
    quantities::{BaseAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{DynamicAccount, MarketFixed, OrderType},
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
    market_info::MarketInfo, open_order::WrapperOpenOrder,
    processors::shared::OpenOrdersTreeReadOnly, wrapper_state::ManifestWrapperStateFixed,
};

use super::shared::{
    check_signer, expand_wrapper_if_needed, get_market_info_index_for_market, sync_fast,
    OpenOrdersTree, UnusedWrapperFreeListPadding, WrapperStateAccountInfo,
    EXPECTED_ORDER_BATCH_SIZE,
};

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct WrapperPlaceOrderParams {
    client_order_id: u64,
    base_atoms: u64,
    price_mantissa: u32,
    price_exponent: i8,
    is_bid: bool,
    last_valid_slot: u32,
    order_type: OrderType,
    min_out_atoms: u64, // TODO: is this still needed?
}
impl WrapperPlaceOrderParams {
    pub fn new(
        client_order_id: u64,
        base_atoms: u64,
        price_mantissa: u32,
        price_exponent: i8,
        is_bid: bool,
        last_valid_slot: u32,
        order_type: OrderType,
        min_out_atoms: u64,
    ) -> Self {
        WrapperPlaceOrderParams {
            client_order_id,
            base_atoms,
            price_mantissa,
            price_exponent,
            is_bid,
            last_valid_slot,
            order_type,
            min_out_atoms,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct WrapperCancelOrderParams {
    client_order_id: u64,
}
impl WrapperCancelOrderParams {
    pub fn new(client_order_id: u64) -> Self {
        WrapperCancelOrderParams { client_order_id }
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct WrapperBatchUpdateParams {
    pub cancels: Vec<WrapperCancelOrderParams>,
    pub cancel_all: bool,
    pub orders: Vec<WrapperPlaceOrderParams>,
    pub trader_index_hint: Option<DataIndex>,
}
impl WrapperBatchUpdateParams {
    pub fn new(
        cancels: Vec<WrapperCancelOrderParams>,
        cancel_all: bool,
        orders: Vec<WrapperPlaceOrderParams>,
        trader_index_hint: Option<DataIndex>,
    ) -> Self {
        WrapperBatchUpdateParams {
            cancels,
            cancel_all,
            orders,
            trader_index_hint,
        }
    }
}

fn prepare_cancels(
    wrapper_state: &WrapperStateAccountInfo,
    cancels: &Vec<WrapperCancelOrderParams>,
    cancel_all: bool,
    orders_root_index: DataIndex,
    remaining_base_atoms: &mut BaseAtoms,
    remaining_quote_atoms: &mut QuoteAtoms,
) -> Result<(Vec<DataIndex>, Vec<CancelOrderParams>), ProgramError> {
    let wrapper_data: Ref<&mut [u8]> = wrapper_state.info.try_borrow_data().unwrap();
    let wrapper: DynamicAccount<&ManifestWrapperStateFixed, &[u8]> =
        get_dynamic_account(&wrapper_data);

    let open_orders_tree: OpenOrdersTreeReadOnly =
        OpenOrdersTreeReadOnly::new(wrapper.dynamic, orders_root_index, NIL);

    let client_ids_to_cancel = {
        let mut set = HashSet::<u64>::with_capacity(cancels.len());
        set.extend(cancels.iter().map(|c| c.client_order_id));
        set
    };

    let mut wrapper_indices: Vec<DataIndex> = Vec::with_capacity(EXPECTED_ORDER_BATCH_SIZE);
    let mut core_cancels: Vec<CancelOrderParams> = Vec::with_capacity(EXPECTED_ORDER_BATCH_SIZE);
    for (wrapper_index, open_order) in open_orders_tree.iter::<WrapperOpenOrder>() {
        if cancel_all || client_ids_to_cancel.contains(&open_order.get_client_order_id()) {
            wrapper_indices.push(wrapper_index);
            core_cancels.push(CancelOrderParams::new_with_hint(
                open_order.get_order_sequence_number(),
                Some(open_order.get_market_data_index()),
            ));
            if open_order.get_is_bid() {
                *remaining_quote_atoms += open_order
                    .get_price()
                    .checked_quote_for_base(open_order.get_num_base_atoms(), true)
                    .unwrap();
            } else {
                *remaining_base_atoms += open_order.get_num_base_atoms();
            };
        }
    }
    Ok((wrapper_indices, core_cancels))
}

fn prepare_orders(
    orders: &Vec<WrapperPlaceOrderParams>,
    remaining_base_atoms: &mut BaseAtoms,
    remaining_quote_atoms: &mut QuoteAtoms,
) -> Vec<PlaceOrderParams> {
    let mut result = Vec::with_capacity(orders.len());
    result.extend(
        orders
            .iter()
            .map(|order: &WrapperPlaceOrderParams| {
                // Possibly reduce the order due to insufficient funds. This is a
                // request from a market maker so that the whole tx doesnt roll back
                // if they do not have the funds on the exchange that the orders
                // require.
                let mut num_base_atoms: u64 = order.base_atoms;
                if order.is_bid {
                    let price = QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(
                        order.price_mantissa,
                        order.price_exponent,
                    )
                    .unwrap();
                    let desired: QuoteAtoms = BaseAtoms::new(order.base_atoms)
                        .checked_mul(price, true)
                        .unwrap();
                    if desired > *remaining_quote_atoms {
                        num_base_atoms = 0;
                    } else {
                        *remaining_quote_atoms -= desired;
                    }
                } else {
                    let desired: BaseAtoms = BaseAtoms::new(order.base_atoms);
                    if desired > *remaining_base_atoms {
                        num_base_atoms = 0;
                    } else {
                        *remaining_base_atoms -= desired;
                    }
                }
                let core_place: PlaceOrderParams = PlaceOrderParams::new(
                    num_base_atoms,
                    order.price_mantissa,
                    order.price_exponent,
                    order.is_bid,
                    order.order_type,
                    order.last_valid_slot,
                );
                core_place
            })
            .filter(|wrapper_place_orders: &PlaceOrderParams| {
                wrapper_place_orders.base_atoms() > 0
            }),
    );
    result
}

fn execute_cpi(
    accounts: &[AccountInfo],
    trader_index_hint: Option<DataIndex>,
    core_cancels: Vec<CancelOrderParams>,
    core_orders: Vec<PlaceOrderParams>,
) -> ProgramResult {
    let mut acc_metas = Vec::with_capacity(accounts.len());
    // fist two accounts are for wrapper and manifest program itself
    // the remainder is passed through directly to manifest
    acc_metas.extend(accounts[2..].iter().map(|ai| {
        if ai.is_writable {
            AccountMeta::new(*ai.key, ai.is_signer)
        } else {
            AccountMeta::new_readonly(*ai.key, ai.is_signer)
        }
    }));

    let ix = Instruction {
        program_id: manifest::id(),
        accounts: acc_metas,
        data: [
            ManifestInstruction::BatchUpdate.to_vec(),
            BatchUpdateParams::new(trader_index_hint, core_cancels, core_orders).try_to_vec()?,
        ]
        .concat(),
    };

    invoke(&ix, &accounts[1..])
}

fn process_cancels(
    wrapper_state: &WrapperStateAccountInfo,
    cancel_indices: &Vec<DataIndex>,
    market_info_index: DataIndex,
) {
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

        for order_wrapper_index in cancel_indices {
            let order_wrapper_index = *order_wrapper_index;
            open_orders_tree.remove_by_index(order_wrapper_index);
        }
        open_orders_tree.get_root_index()
    };

    // save new root
    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(wrapper.dynamic, market_info_index).get_mut_value();
    market_info.orders_root_index = orders_root_index;

    // add nodes to freelist
    let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
        FreeList::new(wrapper.dynamic, wrapper.fixed.free_list_head_index);
    for order_wrapper_index in cancel_indices {
        let order_wrapper_index = *order_wrapper_index;

        if order_wrapper_index != NIL {
            free_list.add(order_wrapper_index);
        }
    }
    wrapper.fixed.free_list_head_index = free_list.get_head();
}

fn process_orders<'a, 'info>(
    payer: &Signer<'a, 'info>,
    system_program: &Program<'a, 'info>,
    wrapper_state: &WrapperStateAccountInfo<'a, 'info>,
    orders: &Vec<WrapperPlaceOrderParams>,
    market_info_index: DataIndex,
) -> ProgramResult {
    let cpi_return_data: Option<(Pubkey, Vec<u8>)> = get_return_data();
    let BatchUpdateReturn {
        orders: batch_update_orders,
    } = BatchUpdateReturn::try_from_slice(&cpi_return_data.unwrap().1[..])?;
    for (index, &(order_sequence_number, order_index)) in batch_update_orders.iter().enumerate() {
        // Order index is NIL when it did not rest. In that case, do not need to store in wrapper.
        if order_index == NIL {
            continue;
        }

        // TODO expand as much as possible in one go
        expand_wrapper_if_needed(wrapper_state, payer, system_program)?;

        let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state.info.try_borrow_mut_data().unwrap();
        let wrapper: DynamicAccount<&mut ManifestWrapperStateFixed, &mut [u8]> =
            get_mut_dynamic_account(&mut wrapper_data);

        let orders_root_index: DataIndex = {
            let market_info: &mut MarketInfo =
                get_mut_helper::<RBNode<MarketInfo>>(wrapper.dynamic, market_info_index)
                    .get_mut_value();
            market_info.orders_root_index
        };

        let wrapper_new_order_index: DataIndex = {
            let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
                FreeList::new(wrapper.dynamic, wrapper.fixed.free_list_head_index);
            let new_index: DataIndex = free_list.remove();
            wrapper.fixed.free_list_head_index = free_list.get_head();
            new_index
        };

        let original_order: &WrapperPlaceOrderParams = &orders[index];
        let price = QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(
            original_order.price_mantissa,
            original_order.price_exponent,
        )?;
        let order: WrapperOpenOrder = WrapperOpenOrder::new(
            original_order.client_order_id,
            order_sequence_number,
            price,
            // Base atoms can be wrong, will be fixed in the sync.
            original_order.base_atoms,
            original_order.last_valid_slot,
            order_index,
            original_order.is_bid,
            original_order.order_type,
        );

        let mut open_orders_tree: OpenOrdersTree =
            OpenOrdersTree::new(wrapper.dynamic, orders_root_index, NIL);
        open_orders_tree.insert(wrapper_new_order_index, order);
        let new_root_index: DataIndex = open_orders_tree.get_root_index();
        let market_info: &mut MarketInfo =
            get_mut_helper::<RBNode<MarketInfo>>(wrapper.dynamic, market_info_index)
                .get_mut_value();
        market_info.orders_root_index = new_root_index;

        drop(wrapper_data);
    }
    Ok(())
}

pub(crate) fn process_batch_update(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    let _manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id())?;
    let payer: Signer = Signer::new(next_account_info(account_iter)?)?;
    let market: ManifestAccountInfo<MarketFixed> =
        ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
    let system_program: Program =
        Program::new(next_account_info(account_iter)?, &system_program::id())?;

    check_signer(&wrapper_state, payer.key);
    let market_info_index: DataIndex = get_market_info_index_for_market(&wrapper_state, market.key);

    // Do an initial sync to get all existing orders and balances fresh. This is
    // needed for modifying user orders for insufficient funds.
    sync_fast(&wrapper_state, &market, market_info_index)?;

    // Cancels are mutable because the user may have mistakenly sent the same
    // one multiple times and the wrapper will take the responsibility for
    // deduping before forwarding to the core.
    let WrapperBatchUpdateParams {
        orders,
        cancel_all,
        cancels,
        trader_index_hint,
    } = WrapperBatchUpdateParams::try_from_slice(data)?;

    let wrapper_data: Ref<&mut [u8]> = wrapper_state.info.try_borrow_data()?;
    let (_fixed_data, wrapper_dynamic_data) =
        wrapper_data.split_at(size_of::<ManifestWrapperStateFixed>());

    let market_info: MarketInfo =
        *get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index).get_value();
    let mut remaining_base_atoms: BaseAtoms = market_info.base_balance;
    let mut remaining_quote_atoms: QuoteAtoms = market_info.quote_balance;
    drop(wrapper_data);

    let (cancel_indices, core_cancels) = prepare_cancels(
        &wrapper_state,
        &cancels,
        cancel_all,
        market_info.orders_root_index,
        &mut remaining_base_atoms,
        &mut remaining_quote_atoms,
    )?;
    let core_orders = prepare_orders(
        &orders,
        &mut remaining_base_atoms,
        &mut remaining_quote_atoms,
    );

    execute_cpi(accounts, trader_index_hint, core_cancels, core_orders)?;

    // Process the cancels
    process_cancels(&wrapper_state, &cancel_indices, market_info_index);

    process_orders(
        &payer,
        &system_program,
        &wrapper_state,
        &orders,
        market_info_index,
    )?;
    // TODO: Enforce min_out_atoms

    // Sync to get the balance correct and remove any expired orders.
    sync_fast(&wrapper_state, &market, market_info_index)?;

    Ok(())
}
