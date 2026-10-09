//! Compact a wrapper account and shrink it to what its entries need.
//!
//! The wrapper only ever grows: cancelled and filled orders put their blocks
//! on a free list that is reused but never released, and `collect` leaves the
//! balance the current size needs. Defrag relinks every market info and open
//! order into the lowest blocks, truncates the account, and leaves the freed
//! rent as excess lamports for `collect` to sweep.
//!
//! Nothing is harvested: every market info and every tracked open order
//! survives byte for byte, only node addresses change, and those are internal
//! to this account. That is what makes it safe for the collector to run
//! against any wrapper: the owner's view, balances and hints into the core
//! market are untouched, and the next instruction syncs as it always does.

use std::mem::size_of;

use crate::{
    market_info::MarketInfo,
    processors::shared::{ensure_orders_list, MarketInfosTreeReadOnly, WRAPPER_BLOCK_SIZE},
    wrapper_state::ManifestWrapperStateFixed,
};
use hypertree::{get_helper, get_mut_helper, DataIndex, HyperTreeValueIteratorTrait, RBNode, NIL};
use manifest::{
    require,
    validation::{next_account_info, AccountViewExt, Signer},
};
use pinocchio::{account::AccountView, error::ProgramError, ProgramResult};
use solana_program::pubkey::Pubkey;

/// Byte offsets inside an `RBNode<V>` header. Identical for every payload.
/// Pinned by `node_layout_offsets_match_accessors`.
const NODE_LEFT: usize = 0;
const NODE_RIGHT: usize = 4;
const NODE_PARENT: usize = 8;

use crate::open_order::WrapperOpenOrder;
use static_assertions::const_assert_eq;
const_assert_eq!(size_of::<RBNode<MarketInfo>>(), WRAPPER_BLOCK_SIZE);
const_assert_eq!(size_of::<RBNode<WrapperOpenOrder>>(), WRAPPER_BLOCK_SIZE);

/// Largest wrapper this will compact. The bitmaps are one bit per block each,
/// so this caps them at 16 KiB of the 32 KiB heap. Far above any account the
/// wrapper's four-block expansion steps produce in practice.
pub const MAX_WRAPPER_DEFRAG_BLOCKS: usize = 65_536;

fn bit(words: &[u64], block: usize) -> bool {
    words[block / 64] & (1u64 << (block % 64)) != 0
}
fn set_bit(words: &mut [u64], block: usize) {
    words[block / 64] |= 1u64 << (block % 64);
}
fn clear_bit(words: &mut [u64], block: usize) {
    words[block / 64] &= !(1u64 << (block % 64));
}

fn read_index(data: &[u8], at: usize) -> DataIndex {
    DataIndex::from_le_bytes(data[at..at + 4].try_into().unwrap())
}
fn write_index(data: &mut [u8], at: usize, value: DataIndex) {
    data[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

fn block_of(index: DataIndex, allocated: usize) -> Result<usize, ProgramError> {
    let at: usize = index as usize;
    require!(
        at % WRAPPER_BLOCK_SIZE == 0 && at + WRAPPER_BLOCK_SIZE <= allocated,
        ProgramError::InvalidAccountData,
        "Node index {} outside the allocation",
        index
    )?;
    Ok(at / WRAPPER_BLOCK_SIZE)
}

/// Slide one node to a lower block and repoint its neighbours. Market infos
/// are red-black nodes whose root lives in the fixed header; open orders are
/// list nodes (previous in `parent`, next in `right`) whose head lives in the
/// owning market info. `old` and `new` are block aligned and cannot overlap
/// because `new < old`. `infos` tracks the market infos' current positions.
fn relocate(
    fixed: &mut ManifestWrapperStateFixed,
    dynamic: &mut [u8],
    old: usize,
    new: usize,
    is_info: bool,
    infos: &mut [DataIndex],
) -> Result<(), ProgramError> {
    dynamic.copy_within(old..old + WRAPPER_BLOCK_SIZE, new);
    let old_index: DataIndex = old as DataIndex;
    let new_index: DataIndex = new as DataIndex;
    if is_info {
        let left: DataIndex = read_index(dynamic, new + NODE_LEFT);
        let right: DataIndex = read_index(dynamic, new + NODE_RIGHT);
        let parent: DataIndex = read_index(dynamic, new + NODE_PARENT);
        if left != NIL {
            write_index(dynamic, left as usize + NODE_PARENT, new_index);
        }
        if right != NIL {
            write_index(dynamic, right as usize + NODE_PARENT, new_index);
        }
        if parent != NIL {
            // Exactly one of the parent's two children named this node.
            let side: usize = if read_index(dynamic, parent as usize + NODE_LEFT) == old_index {
                NODE_LEFT
            } else if read_index(dynamic, parent as usize + NODE_RIGHT) == old_index {
                NODE_RIGHT
            } else {
                return Err(ProgramError::InvalidAccountData);
            };
            write_index(dynamic, parent as usize + side, new_index);
        } else {
            fixed.market_infos_root_index = new_index;
        }
        for tracked in infos.iter_mut() {
            if *tracked == old_index {
                *tracked = new_index;
            }
        }
    } else {
        let prev: DataIndex = read_index(dynamic, new + NODE_PARENT);
        let next: DataIndex = read_index(dynamic, new + NODE_RIGHT);
        if next != NIL {
            require!(
                read_index(dynamic, next as usize + NODE_PARENT) == old_index,
                ProgramError::InvalidAccountData,
                "Order at {} is missing from its successor's links",
                old_index
            )?;
            write_index(dynamic, next as usize + NODE_PARENT, new_index);
        }
        if prev != NIL {
            require!(
                read_index(dynamic, prev as usize + NODE_RIGHT) == old_index,
                ProgramError::InvalidAccountData,
                "Order at {} is missing from its predecessor's links",
                old_index
            )?;
            write_index(dynamic, prev as usize + NODE_RIGHT, new_index);
        } else {
            // A list head is named by exactly one market info.
            let mut found: bool = false;
            for tracked in infos.iter() {
                let info: &mut MarketInfo =
                    get_mut_helper::<RBNode<MarketInfo>>(dynamic, *tracked).get_mut_value();
                if info.orders_root_index == old_index {
                    info.orders_root_index = new_index;
                    found = true;
                    break;
                }
            }
            require!(
                found,
                ProgramError::InvalidAccountData,
                "Order head at {} has no owning market info",
                old_index
            )?;
        }
    }
    Ok(())
}

/// Compact the wrapper in place and return the account size its surviving
/// entries need. Caller truncates to that size after dropping borrows.
pub fn defragment(wrapper_data: &mut [u8]) -> Result<usize, ProgramError> {
    let (fixed_data, dynamic) = wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());
    let fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);
    let allocated: usize = fixed.num_bytes_allocated as usize;
    require!(
        allocated <= dynamic.len() && allocated % WRAPPER_BLOCK_SIZE == 0,
        ProgramError::InvalidAccountData,
        "Invalid allocation"
    )?;
    let blocks: usize = allocated / WRAPPER_BLOCK_SIZE;
    require!(
        blocks <= MAX_WRAPPER_DEFRAG_BLOCKS,
        ProgramError::InvalidAccountData,
        "Wrapper has {} blocks, more than the {} this can compact",
        blocks,
        MAX_WRAPPER_DEFRAG_BLOCKS
    )?;

    // Enumerate the market infos, then convert any legacy orders tree to the
    // list layout so relocation deals with exactly two link shapes. The nodes
    // keep their addresses, so this commutes with everything below.
    let mut infos: Vec<DataIndex> = Vec::new();
    {
        let tree: MarketInfosTreeReadOnly =
            MarketInfosTreeReadOnly::new(dynamic, fixed.market_infos_root_index, NIL);
        for (index, _) in tree.iter::<MarketInfo>() {
            require!(
                infos.len() < blocks,
                ProgramError::InvalidAccountData,
                "Market infos exceed the allocation"
            )?;
            infos.push(index);
        }
    }
    for info_index in infos.iter() {
        ensure_orders_list(dynamic, *info_index);
    }

    // Everything reachable survives; defrag never discards an entry. One
    // bitmap marks live blocks, the other tells the two node kinds apart,
    // because free-list blocks and list nodes both read as payload type zero.
    let mut keep: Vec<u64> = vec![0u64; blocks.div_ceil(64)];
    let mut is_info: Vec<u64> = vec![0u64; blocks.div_ceil(64)];
    let mut kept: usize = 0;
    for info_index in infos.iter() {
        let block: usize = block_of(*info_index, allocated)?;
        require!(
            !bit(&keep, block),
            ProgramError::InvalidAccountData,
            "Market info at {} reached twice",
            info_index
        )?;
        set_bit(&mut keep, block);
        set_bit(&mut is_info, block);
        kept += 1;
        let mut order_index: DataIndex = get_helper::<RBNode<MarketInfo>>(dynamic, *info_index)
            .get_value()
            .orders_root_index;
        while order_index != NIL {
            let order_block: usize = block_of(order_index, allocated)?;
            require!(
                !bit(&keep, order_block),
                ProgramError::InvalidAccountData,
                "Order at {} reached twice",
                order_index
            )?;
            set_bit(&mut keep, order_block);
            kept += 1;
            order_index = read_index(dynamic, order_block * WRAPPER_BLOCK_SIZE + NODE_RIGHT);
        }
    }

    // Slide each survivor, highest first, into the lowest hole beneath it.
    // Both cursors only ever advance, so one pass packs the survivors into
    // the low blocks and everything above them is truncated away.
    let mut hole: usize = 0;
    let mut block: usize = blocks;
    while block > 0 {
        block -= 1;
        if !bit(&keep, block) {
            continue;
        }
        while hole < block && bit(&keep, hole) {
            hole += 1;
        }
        if hole >= block {
            break;
        }
        let moving_info: bool = bit(&is_info, block);
        relocate(
            fixed,
            dynamic,
            block * WRAPPER_BLOCK_SIZE,
            hole * WRAPPER_BLOCK_SIZE,
            moving_info,
            &mut infos,
        )?;
        clear_bit(&mut keep, block);
        set_bit(&mut keep, hole);
        if moving_info {
            clear_bit(&mut is_info, block);
            set_bit(&mut is_info, hole);
        }
    }

    // Fully packed: no free blocks remain. Every mutating wrapper path calls
    // `ensure_free_slots` with its payer before inserting, so an empty free
    // list only means the next insert grows the account the normal way.
    fixed.num_bytes_allocated = (kept * WRAPPER_BLOCK_SIZE) as u32;
    fixed.free_list_head_index = NIL;
    Ok(size_of::<ManifestWrapperStateFixed>() + kept * WRAPPER_BLOCK_SIZE)
}

pub(crate) fn process_defrag(
    _program_id: &Pubkey,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    require!(
        data.is_empty(),
        ProgramError::InvalidInstructionData,
        "Defrag takes no instruction data"
    )?;
    let account_iter: &mut std::slice::Iter<AccountView> = &mut accounts.iter();
    let wrapper_state: crate::loader::WrapperStateAccountInfo =
        crate::loader::WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    let authority: Signer = Signer::new(next_account_info(account_iter)?)?;
    require!(
        wrapper_state.info.is_writable(),
        ProgramError::InvalidAccountData,
        "Wrapper state must be writable"
    )?;
    let trader: Pubkey = {
        let wrapper_data = wrapper_state.info.try_borrow()?;
        let (fixed_data, _) = wrapper_data.split_at(size_of::<ManifestWrapperStateFixed>());
        get_helper::<ManifestWrapperStateFixed>(fixed_data, 0).trader
    };
    // Compaction keeps every entry, so the collector running it cannot cost
    // the owner anything; the freed rent stays on the account for `collect`.
    require!(
        *authority.pubkey() == trader || *authority.pubkey() == crate::COLLECTOR,
        ProgramError::InvalidArgument,
        "Defrag authority must be the wrapper owner or the collector"
    )?;
    let size: usize = {
        let mut wrapper_data = wrapper_state.info.try_borrow_mut()?;
        defragment(&mut wrapper_data)?
    };
    wrapper_state.info.resize(size)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processors::shared::{
        expand_wrapper, MarketInfosTree, OpenOrdersList, OpenOrdersListReadOnly,
        UnusedWrapperFreeListPadding, ORDERS_LAYOUT_LIST, ORDERS_LAYOUT_TREE,
    };
    use hypertree::{FreeList, HyperTreeReadOperations, HyperTreeWriteOperations, RedBlackTree};
    use manifest::{
        quantities::{BaseAtoms, WrapperU64},
        state::{constants::NO_EXPIRATION_LAST_VALID_SLOT, OrderType},
    };

    const FIXED: usize = size_of::<ManifestWrapperStateFixed>();

    fn wrapper(blocks: usize) -> Vec<u8> {
        let mut data: Vec<u8> = vec![0u8; FIXED + blocks * WRAPPER_BLOCK_SIZE];
        *get_mut_helper::<ManifestWrapperStateFixed>(&mut data, 0) =
            ManifestWrapperStateFixed::new_empty(&Pubkey::new_unique());
        for _ in 0..blocks {
            expand_wrapper(&mut data);
        }
        data
    }

    fn alloc(data: &mut [u8]) -> DataIndex {
        let (fixed_data, dynamic) = data.split_at_mut(FIXED);
        let fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);
        let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
            FreeList::new(dynamic, fixed.free_list_head_index);
        let index: DataIndex = free_list.remove();
        fixed.free_list_head_index = free_list.get_head();
        assert_ne!(index, NIL, "test fixture ran out of blocks");
        index
    }

    fn release(data: &mut [u8], index: DataIndex) {
        let (fixed_data, dynamic) = data.split_at_mut(FIXED);
        let fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);
        let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
            FreeList::new(dynamic, fixed.free_list_head_index);
        free_list.add(index);
        fixed.free_list_head_index = free_list.get_head();
    }

    fn claim_market(data: &mut [u8], market: Pubkey) -> DataIndex {
        let index: DataIndex = alloc(data);
        let (fixed_data, dynamic) = data.split_at_mut(FIXED);
        let fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);
        let mut tree: MarketInfosTree =
            MarketInfosTree::new(dynamic, fixed.market_infos_root_index, NIL);
        tree.insert(index, MarketInfo::new_empty(market, NIL));
        fixed.market_infos_root_index = tree.get_root_index();
        get_mut_helper::<RBNode<MarketInfo>>(dynamic, index).set_payload_type(ORDERS_LAYOUT_LIST);
        index
    }

    fn order(client_order_id: u64) -> WrapperOpenOrder {
        WrapperOpenOrder::new(
            client_order_id,
            client_order_id + 1000,
            1.0.try_into().unwrap(),
            BaseAtoms::new(1),
            NO_EXPIRATION_LAST_VALID_SLOT,
            (client_order_id as DataIndex) * 80,
            true,
            OrderType::Limit,
        )
    }

    fn place(data: &mut [u8], info_index: DataIndex, client_order_id: u64) -> DataIndex {
        let index: DataIndex = alloc(data);
        let (_, dynamic) = data.split_at_mut(FIXED);
        let head: DataIndex = get_helper::<RBNode<MarketInfo>>(dynamic, info_index)
            .get_value()
            .orders_root_index;
        let mut list: OpenOrdersList = OpenOrdersList::new(dynamic, head);
        list.insert(index, order(client_order_id));
        get_mut_helper::<RBNode<MarketInfo>>(dynamic, info_index)
            .get_mut_value()
            .orders_root_index = index;
        index
    }

    fn cancel(data: &mut [u8], info_index: DataIndex, order_index: DataIndex) {
        let (_, dynamic) = data.split_at_mut(FIXED);
        let head: DataIndex = get_helper::<RBNode<MarketInfo>>(dynamic, info_index)
            .get_value()
            .orders_root_index;
        let mut list: OpenOrdersList = OpenOrdersList::new(dynamic, head);
        list.remove_by_index(order_index);
        let new_head: DataIndex = list.get_root_index();
        get_mut_helper::<RBNode<MarketInfo>>(dynamic, info_index)
            .get_mut_value()
            .orders_root_index = new_head;
        release(data, order_index);
    }

    /// Market info index for a market, walking the live tree.
    fn find_market(data: &[u8], market: &Pubkey) -> DataIndex {
        let fixed: &ManifestWrapperStateFixed = get_helper(&data[..FIXED], 0);
        let tree: MarketInfosTreeReadOnly =
            MarketInfosTreeReadOnly::new(&data[FIXED..], fixed.market_infos_root_index, NIL);
        tree.lookup_index(&MarketInfo::new_empty(*market, NIL))
    }

    /// Client order ids in list order for one market, validating links.
    fn orders_of(data: &[u8], market: &Pubkey) -> Vec<u64> {
        let info_index: DataIndex = find_market(data, market);
        assert_ne!(info_index, NIL);
        let dynamic: &[u8] = &data[FIXED..];
        let node: &RBNode<MarketInfo> = get_helper::<RBNode<MarketInfo>>(dynamic, info_index);
        assert_eq!(node.get_payload_type(), ORDERS_LAYOUT_LIST);
        let head: DataIndex = node.get_value().orders_root_index;
        hypertree::validate_linked_list::<WrapperOpenOrder>(dynamic, head).unwrap();
        let list: OpenOrdersListReadOnly = OpenOrdersListReadOnly::new(dynamic, head);
        let mut ids: Vec<u64> = Vec::new();
        let mut index: DataIndex = head;
        let mut prev: DataIndex = NIL;
        while index != NIL {
            assert_eq!(list.get_prev_index(index), prev);
            ids.push(
                get_helper::<RBNode<WrapperOpenOrder>>(dynamic, index)
                    .get_value()
                    .get_client_order_id(),
            );
            prev = index;
            index = list.get_next_index(index);
        }
        ids
    }

    fn free_count(data: &[u8]) -> usize {
        let fixed: &ManifestWrapperStateFixed = get_helper(&data[..FIXED], 0);
        let mut count: usize = 0;
        let mut index: DataIndex = fixed.free_list_head_index;
        while index != NIL {
            count += 1;
            assert!(count < 10_000);
            index = read_index(&data[FIXED..], index as usize);
        }
        count
    }

    #[test]
    fn node_layout_offsets_match_accessors() {
        let mut data: Vec<u8> = vec![0u8; WRAPPER_BLOCK_SIZE * 2];
        {
            let mut list: OpenOrdersList = OpenOrdersList::new(&mut data, NIL);
            list.insert(0, order(1));
            list.insert(WRAPPER_BLOCK_SIZE as DataIndex, order(2));
        }
        let head: DataIndex = WRAPPER_BLOCK_SIZE as DataIndex;
        let list: OpenOrdersListReadOnly = OpenOrdersListReadOnly::new(&data, head);
        // Next in `right`, previous in `parent`, `left` always NIL.
        assert_eq!(read_index(&data, WRAPPER_BLOCK_SIZE + NODE_RIGHT), 0);
        assert_eq!(list.get_next_index(head), 0);
        assert_eq!(read_index(&data, WRAPPER_BLOCK_SIZE + NODE_PARENT), NIL);
        assert_eq!(read_index(&data, WRAPPER_BLOCK_SIZE + NODE_LEFT), NIL);
        assert_eq!(read_index(&data, NODE_PARENT), head);
        assert_eq!(list.get_prev_index(0), head);
    }

    #[test]
    fn compacts_holes_preserves_entries_and_is_idempotent() {
        let mut data: Vec<u8> = wrapper(40);
        let market_a: Pubkey = Pubkey::new_from_array([1; 32]);
        let market_b: Pubkey = Pubkey::new_from_array([2; 32]);
        let info_a: DataIndex = claim_market(&mut data, market_a);
        // Interleave so compaction has to move both node kinds past holes.
        let o1: DataIndex = place(&mut data, info_a, 1);
        let o2: DataIndex = place(&mut data, info_a, 2);
        let info_b: DataIndex = claim_market(&mut data, market_b);
        let o3: DataIndex = place(&mut data, info_a, 3);
        let o4: DataIndex = place(&mut data, info_b, 4);
        let o5: DataIndex = place(&mut data, info_b, 5);
        let _ = o1;
        cancel(&mut data, info_a, o2);
        cancel(&mut data, info_b, o4);
        let before_a: Vec<u64> = orders_of(&data, &market_a);
        let before_b: Vec<u64> = orders_of(&data, &market_b);
        let _ = (o3, o5);

        let size: usize = defragment(&mut data).unwrap();
        // Two market infos and three orders survive, nothing else.
        assert_eq!(size, FIXED + 5 * WRAPPER_BLOCK_SIZE);
        data.truncate(size);
        assert_eq!(orders_of(&data, &market_a), before_a);
        assert_eq!(orders_of(&data, &market_b), before_b);
        assert_eq!(free_count(&data), 0);
        let fixed: &ManifestWrapperStateFixed = get_helper(&data[..FIXED], 0);
        assert_eq!(fixed.num_bytes_allocated as usize, 5 * WRAPPER_BLOCK_SIZE);

        // Converged, so a second run changes nothing.
        let copy: Vec<u8> = data.clone();
        let again: usize = defragment(&mut data).unwrap();
        assert_eq!(again, size);
        assert_eq!(data, copy);
    }

    #[test]
    fn an_empty_wrapper_shrinks_to_its_header() {
        let mut data: Vec<u8> = wrapper(12);
        let size: usize = defragment(&mut data).unwrap();
        assert_eq!(size, FIXED);
        data.truncate(size);
        let fixed: &ManifestWrapperStateFixed = get_helper(&data[..FIXED], 0);
        assert_eq!(fixed.num_bytes_allocated, 0);
        assert_eq!(fixed.free_list_head_index, NIL);
        assert_eq!(fixed.market_infos_root_index, NIL);
    }

    #[test]
    fn converts_a_legacy_orders_tree_and_compacts_it() {
        let mut data: Vec<u8> = wrapper(30);
        let market: Pubkey = Pubkey::new_from_array([3; 32]);
        let info: DataIndex = claim_market(&mut data, market);
        // Lay the orders out as the pre-list red-black tree, under the old
        // layout flag, the way wrappers from before the list look.
        let mut indices: Vec<DataIndex> = Vec::new();
        for _ in 0..5 {
            indices.push(alloc(&mut data));
        }
        {
            let (_, dynamic) = data.split_at_mut(FIXED);
            let mut tree: RedBlackTree<WrapperOpenOrder> = RedBlackTree::new(dynamic, NIL, NIL);
            for (at, index) in indices.iter().enumerate() {
                tree.insert(*index, order(at as u64 + 10));
            }
            let root: DataIndex = tree.get_root_index();
            let info_node: &mut RBNode<MarketInfo> =
                get_mut_helper::<RBNode<MarketInfo>>(dynamic, info);
            info_node.get_mut_value().orders_root_index = root;
            info_node.set_payload_type(ORDERS_LAYOUT_TREE);
        }

        let size: usize = defragment(&mut data).unwrap();
        assert_eq!(size, FIXED + 6 * WRAPPER_BLOCK_SIZE);
        data.truncate(size);
        let mut ids: Vec<u64> = orders_of(&data, &market);
        ids.sort();
        assert_eq!(ids, vec![10, 11, 12, 13, 14]);
    }

    #[test]
    fn rejects_an_order_missing_from_its_predecessor() {
        let mut data: Vec<u8> = wrapper(20);
        let market: Pubkey = Pubkey::new_from_array([4; 32]);
        let info: DataIndex = claim_market(&mut data, market);
        let first: DataIndex = place(&mut data, info, 1);
        let _second: DataIndex = place(&mut data, info, 2);
        // Leave a hole above nothing: fill the low blocks so the list nodes
        // sit high and must move, then break the link that relocation checks.
        cancel(&mut data, info, first);
        let (_, dynamic) = data.split_at_mut(FIXED);
        let head: DataIndex = get_helper::<RBNode<MarketInfo>>(dynamic, info)
            .get_value()
            .orders_root_index;
        // The head claims no predecessor; corrupt the owning market info so
        // no one names it.
        get_mut_helper::<RBNode<MarketInfo>>(dynamic, info)
            .get_mut_value()
            .orders_root_index = head + WRAPPER_BLOCK_SIZE as DataIndex;
        assert!(defragment(&mut data).is_err());
    }

    #[test]
    fn oversized_wrappers_are_rejected() {
        let mut data: Vec<u8> = wrapper(1);
        let fixed: &mut ManifestWrapperStateFixed = get_mut_helper(&mut data, 0);
        fixed.num_bytes_allocated = ((MAX_WRAPPER_DEFRAG_BLOCKS + 1) * WRAPPER_BLOCK_SIZE) as u32;
        let target: usize = FIXED + (MAX_WRAPPER_DEFRAG_BLOCKS + 1) * WRAPPER_BLOCK_SIZE;
        data.resize(target, 0);
        assert_eq!(
            defragment(&mut data).unwrap_err(),
            ProgramError::InvalidAccountData
        );
    }
}
