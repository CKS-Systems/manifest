use std::{
    cell::{Ref, RefMut},
    mem::size_of,
    ops::Deref,
};

use crate::{
    market_info::MarketInfo, open_order::WrapperOpenOrder, wrapper_state::ManifestWrapperStateFixed,
};
use bytemuck::{Pod, Zeroable};
use hypertree::{
    get_helper, get_mut_helper, trace, DataIndex, FreeList, HyperTreeReadOperations,
    HyperTreeValueIteratorTrait, HyperTreeWriteOperations, RBNode, RedBlackTree,
    RedBlackTreeReadOnly, NIL,
};
use manifest::{
    program::assert_with_msg,
    quantities::BaseAtoms,
    state::{claimed_seat::ClaimedSeat, MarketRef, RestingOrder},
    validation::{Program, Signer},
};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};
use static_assertions::const_assert_eq;

pub const WRAPPER_BLOCK_PAYLOAD_SIZE: usize = 64;
pub const BLOCK_HEADER_SIZE: usize = 16;
pub const WRAPPER_BLOCK_SIZE: usize = WRAPPER_BLOCK_PAYLOAD_SIZE + BLOCK_HEADER_SIZE;

#[repr(C, packed)]
#[derive(Default, Copy, Clone, Pod, Zeroable)]
pub struct UnusedWrapperFreeListPadding {
    _padding: [u64; 7],
    _padding2: [u32; 5],
}
pub const FREE_LIST_HEADER_SIZE: usize = 4;
// Assert that the free list blocks take up the same size as regular blocks.
const_assert_eq!(
    size_of::<UnusedWrapperFreeListPadding>(),
    WRAPPER_BLOCK_SIZE - FREE_LIST_HEADER_SIZE
);
// Does not align to 8 bytes but not necessary
// const_assert_eq!(size_of::<UnusedWrapperFreeListPadding>() % 8, 0);

pub(crate) fn expand_wrapper_if_needed<'a, 'info>(
    wrapper_state_account_info: &WrapperStateAccountInfo<'a, 'info>,
    payer: &Signer<'a, 'info>,
    system_program: &Program<'a, 'info>,
) -> ProgramResult {
    let need_expand: bool = does_need_expand(wrapper_state_account_info);
    if !need_expand {
        return Ok(());
    }

    {
        let wrapper_state: &AccountInfo = wrapper_state_account_info.info;

        let wrapper_data: Ref<&mut [u8]> = wrapper_state.try_borrow_data()?;
        let new_size: usize = wrapper_data.len() + WRAPPER_BLOCK_SIZE;
        drop(wrapper_data);

        let rent: Rent = Rent::get()?;
        let new_minimum_balance: u64 = rent.minimum_balance(new_size);
        let lamports_diff: u64 = new_minimum_balance.saturating_sub(wrapper_state.lamports());

        invoke(
            &system_instruction::transfer(payer.key, wrapper_state.key, lamports_diff),
            &[
                payer.info.clone(),
                wrapper_state.clone(),
                system_program.info.clone(),
            ],
        )?;

        trace!(
            "expand_if_needed -> realloc {} {:?}",
            new_size,
            wrapper_state.key
        );
        #[cfg(feature = "fuzz")]
        {
            invoke(
                &system_instruction::allocate(wrapper_state.key, new_size as u64),
                &[wrapper_state.clone(), system_program.info.clone()],
            )?;
        }
        #[cfg(not(feature = "fuzz"))]
        {
            wrapper_state.realloc(new_size, false)?;
        }
    }

    let wrapper_state_info: &AccountInfo = wrapper_state_account_info.info;
    let wrapper_data: &mut [u8] = &mut wrapper_state_info.try_borrow_mut_data().unwrap();
    expand_wrapper(wrapper_data);

    Ok(())
}

pub fn expand_wrapper(wrapper_data: &mut [u8]) {
    let (fixed_data, dynamic_data) =
        wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());

    let wrapper_fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);
    let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
        FreeList::new(dynamic_data, wrapper_fixed.free_list_head_index);

    free_list.add(wrapper_fixed.num_bytes_allocated);
    wrapper_fixed.num_bytes_allocated += WRAPPER_BLOCK_SIZE as u32;
    wrapper_fixed.free_list_head_index = free_list.get_head();
}

fn does_need_expand(wrapper_state: &WrapperStateAccountInfo) -> bool {
    let wrapper_data: Ref<&mut [u8]> = wrapper_state.info.try_borrow_data().unwrap();
    let (fixed_data, _dynamic_data) = wrapper_data.split_at(size_of::<ManifestWrapperStateFixed>());

    let wrapper_fixed: &ManifestWrapperStateFixed = get_helper(fixed_data, 0);
    return wrapper_fixed.free_list_head_index == NIL;
}

pub(crate) fn check_signer(wrapper_state: &WrapperStateAccountInfo, owner_key: &Pubkey) {
    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state.info.try_borrow_mut_data().unwrap();
    let (header_bytes, _wrapper_dynamic_data) =
        wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());
    let header: &ManifestWrapperStateFixed =
        get_helper::<ManifestWrapperStateFixed>(header_bytes, 0_u32);
    assert_eq!(header.trader, *owner_key);
}

pub(crate) fn sync(
    wrapper_state: &WrapperStateAccountInfo,
    market: &Pubkey,
    market_ref: MarketRef,
) -> ProgramResult {
    let market_info_index: DataIndex = get_market_info_index_for_market(&wrapper_state, market);

    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state.info.try_borrow_mut_data().unwrap();
    let (fixed_data, wrapper_dynamic_data) =
        wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());

    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index)
            .get_mut_value();
    let mut orders_root_index: DataIndex = market_info.orders_root_index;

    if orders_root_index != NIL {
        let orders_tree: OpenOrdersTreeReadOnly =
            OpenOrdersTreeReadOnly::new(wrapper_dynamic_data, orders_root_index, NIL);

        // Cannot do this in one pass because we need the data borrowed for the
        // iterator so cannot also borrow it for updating the nodes.
        let mut to_remove_indices: Vec<DataIndex> = Vec::new();
        let mut to_update_and_core_indices: Vec<(DataIndex, DataIndex)> = Vec::new();
        for (order_index, order) in orders_tree.iter::<WrapperOpenOrder>() {
            let expected_sequence_number: u64 = order.get_order_sequence_number();
            let core_data_index: DataIndex = order.get_market_data_index();
            // Verifies that it is not just zeroed and happens to match seq num,
            // also check that there are base atoms left.
            let core_resting_order: &RestingOrder =
                get_helper::<RBNode<RestingOrder>>(market_ref.dynamic, core_data_index).get_value();
            if core_resting_order.get_sequence_number() != expected_sequence_number
                || core_resting_order.get_num_base_atoms() == BaseAtoms::ZERO
            {
                to_remove_indices.push(order_index);
            } else {
                to_update_and_core_indices.push((order_index, core_data_index));
            }
        }
        // Update the amounts if there was partial fills.
        for (to_update_index, core_data_index) in to_update_and_core_indices.iter() {
            let node: &mut RBNode<WrapperOpenOrder> =
                get_mut_helper::<RBNode<WrapperOpenOrder>>(wrapper_dynamic_data, *to_update_index);
            let core_resting_order: &RestingOrder =
                get_helper::<RBNode<RestingOrder>>(market_ref.dynamic, *core_data_index)
                    .get_value();
            node.get_mut_value()
                .update_remaining(core_resting_order.get_num_base_atoms());

            // Needed because the way things are added could be off by 1 when
            // one of the orders fully matches as it is being placed. We only
            // know that the indices are right, not the actual orders there.
            node.get_mut_value()
                .set_price(core_resting_order.get_price());
            node.get_mut_value()
                .set_is_bid(core_resting_order.get_is_bid());
        }
        let mut orders_tree: RedBlackTree<WrapperOpenOrder> =
            RedBlackTree::<WrapperOpenOrder>::new(wrapper_dynamic_data, orders_root_index, NIL);
        for to_remove_index in to_remove_indices.iter() {
            orders_tree.remove_by_index(*to_remove_index);
        }
        orders_root_index = orders_tree.get_root_index();

        let wrapper_fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);
        let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
            FreeList::new(wrapper_dynamic_data, wrapper_fixed.free_list_head_index);
        for open_order_index in to_remove_indices.iter() {
            // Free the node in wrapper.
            free_list.add(*open_order_index);
        }
        wrapper_fixed.free_list_head_index = free_list.get_head();
    }
    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index)
            .get_mut_value();
    market_info.orders_root_index = orders_root_index;

    // Sync balances
    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index)
            .get_mut_value();
    let claimed_seat: &ClaimedSeat =
        get_helper::<RBNode<ClaimedSeat>>(market_ref.dynamic, market_info.trader_index).get_value();
    market_info.base_balance = claimed_seat.base_withdrawable_balance;
    market_info.quote_balance = claimed_seat.quote_withdrawable_balance;
    market_info.last_updated_slot = Clock::get().unwrap().slot as u32;

    Ok(())
}

pub(crate) fn get_market_info_index_for_market(
    wrapper_state: &WrapperStateAccountInfo,
    market: &Pubkey,
) -> DataIndex {
    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state.info.try_borrow_mut_data().unwrap();
    let (fixed_data, wrapper_dynamic_data) =
        wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());

    let wrapper_fixed: &ManifestWrapperStateFixed = get_helper(fixed_data, 0);
    let market_infos_tree: MarketInfosTree = MarketInfosTree::new(
        wrapper_dynamic_data,
        wrapper_fixed.market_infos_root_index,
        NIL,
    );

    // Just need to lookup by market key so the rest doesnt matter.
    let market_info_index: DataIndex =
        market_infos_tree.lookup_index(&MarketInfo::new_empty(*market, NIL));
    market_info_index
}

pub(crate) fn get_wrapper_order_indexes_by_client_order_id(
    wrapper_state: &WrapperStateAccountInfo,
    market_key: &Pubkey,
    client_order_id: u64,
) -> Vec<DataIndex> {
    // Lookup all orders with that client_order_id
    let market_info_index: DataIndex = get_market_info_index_for_market(wrapper_state, market_key);
    let wrapper_data: Ref<&mut [u8]> = wrapper_state.info.try_borrow_data().unwrap();
    let (_fixed_data, wrapper_dynamic_data) =
        wrapper_data.split_at(size_of::<ManifestWrapperStateFixed>());

    let orders_root_index: DataIndex =
        get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index)
            .get_value()
            .orders_root_index;

    let matching_order_indexes: Vec<DataIndex> = lookup_order_indexes_by_client_order_id(
        client_order_id,
        wrapper_dynamic_data,
        orders_root_index,
    );

    matching_order_indexes
}

pub(crate) fn lookup_order_indexes_by_client_order_id(
    client_order_id: u64,
    wrapper_dynamic_data: &[u8],
    orders_root_index: DataIndex,
) -> Vec<DataIndex> {
    let open_orders_tree: OpenOrdersTreeReadOnly =
        OpenOrdersTreeReadOnly::new(wrapper_dynamic_data, orders_root_index, NIL);
    let matching_order_index: DataIndex =
        open_orders_tree.lookup_index(&WrapperOpenOrder::new_empty(client_order_id));

    let mut result: Vec<DataIndex> = Vec::new();
    result.push(matching_order_index);

    let mut current_order_index: DataIndex =
        open_orders_tree.get_next_lower_index::<WrapperOpenOrder>(matching_order_index);
    while current_order_index != NIL {
        if get_helper::<RBNode<WrapperOpenOrder>>(wrapper_dynamic_data, current_order_index)
            .get_value()
            .get_client_order_id()
            != client_order_id
        {
            break;
        }
        result.push(current_order_index);
        current_order_index =
            open_orders_tree.get_next_lower_index::<WrapperOpenOrder>(current_order_index);
    }

    let mut current_order_index: DataIndex =
        open_orders_tree.get_next_higher_index::<WrapperOpenOrder>(matching_order_index);
    while current_order_index != NIL {
        if get_helper::<RBNode<WrapperOpenOrder>>(wrapper_dynamic_data, current_order_index)
            .get_value()
            .get_client_order_id()
            != client_order_id
        {
            break;
        }
        result.push(current_order_index);
        current_order_index =
            open_orders_tree.get_next_higher_index::<WrapperOpenOrder>(current_order_index);
    }

    // Not necessary but useful in practice.
    result.sort_unstable();
    result.dedup();

    result
}

/// Validation for wrapper account
#[derive(Clone)]
pub struct WrapperStateAccountInfo<'a, 'info> {
    pub(crate) info: &'a AccountInfo<'info>,
}
pub type MarketInfosTree<'a> = RedBlackTree<'a, MarketInfo>;
pub type MarketInfosTreeReadOnly<'a> = RedBlackTreeReadOnly<'a, MarketInfo>;
pub type OpenOrdersTree<'a> = RedBlackTree<'a, WrapperOpenOrder>;
pub type OpenOrdersTreeReadOnly<'a> = RedBlackTreeReadOnly<'a, WrapperOpenOrder>;

pub const WRAPPER_STATE_DISCRIMINANT: u64 = 1;

impl<'a, 'info> WrapperStateAccountInfo<'a, 'info> {
    #[inline(always)]
    fn _new_unchecked(
        info: &'a AccountInfo<'info>,
    ) -> Result<WrapperStateAccountInfo<'a, 'info>, ProgramError> {
        assert_with_msg(
            info.owner == &crate::ID,
            ProgramError::IllegalOwner,
            "Wrapper must be owned by the program",
        )?;
        Ok(Self { info })
    }

    pub fn new(
        info: &'a AccountInfo<'info>,
    ) -> Result<WrapperStateAccountInfo<'a, 'info>, ProgramError> {
        let wrapper_state: WrapperStateAccountInfo<'a, 'info> = Self::_new_unchecked(info)?;

        let market_bytes: Ref<&mut [u8]> = info.try_borrow_data()?;
        let (header_bytes, _) = market_bytes.split_at(size_of::<ManifestWrapperStateFixed>());
        let header: &ManifestWrapperStateFixed =
            get_helper::<ManifestWrapperStateFixed>(header_bytes, 0_u32);

        assert_with_msg(
            header.discriminant == WRAPPER_STATE_DISCRIMINANT,
            ProgramError::InvalidAccountData,
            "Invalid wrapper state discriminant",
        )?;

        Ok(wrapper_state)
    }

    pub fn new_init(
        info: &'a AccountInfo<'info>,
    ) -> Result<WrapperStateAccountInfo<'a, 'info>, ProgramError> {
        let market_bytes: Ref<&mut [u8]> = info.try_borrow_data()?;
        let (header_bytes, _) = market_bytes.split_at(size_of::<ManifestWrapperStateFixed>());
        let header: &ManifestWrapperStateFixed =
            get_helper::<ManifestWrapperStateFixed>(header_bytes, 0_u32);
        assert_with_msg(
            info.owner == &crate::ID,
            ProgramError::IllegalOwner,
            "Market must be owned by the Manifest program",
        )?;
        // On initialization, the discriminant is not set yet.
        assert_with_msg(
            header.discriminant == 0,
            ProgramError::InvalidAccountData,
            "Expected uninitialized market with discriminant 0",
        )?;
        Ok(Self { info })
    }
}

impl<'a, 'info> Deref for WrapperStateAccountInfo<'a, 'info> {
    type Target = AccountInfo<'info>;

    fn deref(&self) -> &Self::Target {
        self.info
    }
}
