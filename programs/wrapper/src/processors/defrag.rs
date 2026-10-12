//! Compact a wrapper account and shrink it to what its entries need.
//!
//! The wrapper only ever grows: cancelled and filled orders put their blocks
//! on a free list that is reused but never released, and `collect` leaves the
//! balance the current size needs. Defrag relinks market infos and open
//! orders into the lowest blocks, truncates the account, and leaves the freed
//! rent as excess lamports for `collect` to sweep.
//!
//! Nothing is harvested: every market info and every tracked open order
//! survives byte for byte, only node addresses change, and those are internal
//! to this account. The owner's view, balances and hints into the core market
//! are untouched, and the next instruction syncs as it always does.
//!
//! A run relocates at most `MAX_WRAPPER_DEFRAG_RELOCATIONS_PER_RUN` blocks
//! (fewer if the instruction data carries a smaller budget), then truncates
//! the free tail and rebuilds the free list over the holes that remain, so a
//! wrapper too fragmented to compact inside one transaction's compute budget
//! converges over repeated calls, each leaving a valid account no larger than
//! it started.

use std::mem::size_of;

use crate::{
    market_info::MarketInfo,
    processors::shared::{ensure_orders_list, UnusedWrapperFreeListPadding, WRAPPER_BLOCK_SIZE},
    wrapper_state::ManifestWrapperStateFixed,
};
use hypertree::{get_helper, get_mut_helper, DataIndex, FreeList, RBNode, NIL};
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

/// Most blocks one run relocates, and the pre-reserved capacity of the moved
/// list-heads fixup table, which caps that table at 8 KiB of heap next to the
/// two bitmaps. The SBF bump allocator never frees, so every heap use here is
/// a single sized allocation; nothing grows. Mirrors the core market defrag's
/// `MAX_MOVED_SEATS_PER_RUN`: a wrapper with more holes than this is
/// compacted by repeated bounded runs.
pub const MAX_WRAPPER_DEFRAG_RELOCATIONS_PER_RUN: u32 = 1_024;

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

/// A child edge a walk is about to follow: in bounds, block aligned, and the
/// child names `parent` back, so both sides agree on the edge before it is
/// descended or rewritten.
fn validated_child(
    dynamic: &[u8],
    parent: DataIndex,
    child: DataIndex,
    allocated: usize,
) -> Result<(), ProgramError> {
    block_of(child, allocated)?;
    require!(
        read_index(dynamic, child as usize + NODE_PARENT) == parent,
        ProgramError::InvalidAccountData,
        "Tree node at {} does not name {} as its parent",
        child,
        parent
    )?;
    Ok(())
}

/// A neighbour whose link field relocation is about to rewrite: in bounds,
/// aligned, and a survivor. A link into a hole means the structures disagree
/// with the mark walk, so fail instead of writing into a block that is about
/// to be reused or truncated.
fn validated_neighbor(
    neighbor: DataIndex,
    allocated: usize,
    keep: &[u64],
) -> Result<(), ProgramError> {
    let block: usize = block_of(neighbor, allocated)?;
    require!(
        bit(keep, block),
        ProgramError::InvalidAccountData,
        "Node at {} is linked to but not reachable",
        neighbor
    )?;
    Ok(())
}

/// Mark every market info reachable from the tree root: one bit in `keep` and
/// one in `is_info` per node. An explicit in-order walk over the parent links
/// instead of the hypertree iterator: every edge is bounds checked and
/// back-link checked before it is followed, every visit is counted against
/// the allocation, and a node reached twice fails, so a corrupt tree errors
/// out cleanly instead of looping, panicking, or writing anywhere.
fn mark_market_infos(
    dynamic: &[u8],
    root: DataIndex,
    allocated: usize,
    keep: &mut [u64],
    is_info: &mut [u64],
) -> Result<(), ProgramError> {
    if root == NIL {
        return Ok(());
    }
    block_of(root, allocated)?;
    require!(
        read_index(dynamic, root as usize + NODE_PARENT) == NIL,
        ProgramError::InvalidAccountData,
        "Market infos root at {} has a parent",
        root
    )?;
    let blocks: usize = allocated / WRAPPER_BLOCK_SIZE;
    let mut visited: usize = 0;
    let mut current: DataIndex = root;
    'subtree: loop {
        // Descend to the leftmost node of the current subtree.
        loop {
            let left: DataIndex = read_index(dynamic, current as usize + NODE_LEFT);
            if left == NIL {
                break;
            }
            validated_child(dynamic, current, left, allocated)?;
            current = left;
        }
        // Visit, then take in-order successors until one opens a new subtree.
        loop {
            let block: usize = block_of(current, allocated)?;
            require!(
                !bit(keep, block),
                ProgramError::InvalidAccountData,
                "Market info at {} reached twice",
                current
            )?;
            set_bit(keep, block);
            set_bit(is_info, block);
            visited += 1;
            require!(
                visited <= blocks,
                ProgramError::InvalidAccountData,
                "Market infos exceed the allocation"
            )?;
            let right: DataIndex = read_index(dynamic, current as usize + NODE_RIGHT);
            if right != NIL {
                validated_child(dynamic, current, right, allocated)?;
                current = right;
                continue 'subtree;
            }
            // Climb until the walk arrives from a left child; that parent is
            // the successor. Every parent link retraces an edge the descent
            // already validated in both directions.
            loop {
                let parent: DataIndex = read_index(dynamic, current as usize + NODE_PARENT);
                if parent == NIL {
                    return Ok(());
                }
                let from_left: bool = read_index(dynamic, parent as usize + NODE_LEFT) == current;
                let from_right: bool = read_index(dynamic, parent as usize + NODE_RIGHT) == current;
                require!(
                    from_left != from_right,
                    ProgramError::InvalidAccountData,
                    "Tree node at {} is not exactly one child of {}",
                    current,
                    parent
                )?;
                current = parent;
                if from_left {
                    break;
                }
            }
        }
    }
}

/// Slide one node to a lower block and repoint its neighbours. Market infos
/// are red-black nodes whose root lives in the fixed header; open orders are
/// list nodes (previous in `parent`, next in `right`). `old` and `new` are
/// block aligned and cannot overlap because `new < old`. A moved list head's
/// owning market info is not searched for here — that would be a scan per
/// move — it is recorded in `moved_heads` and repointed in one pass after the
/// sweep. Every neighbour write is preceded by bounds, survivor, and
/// back-link checks, so a corrupt account fails instead of being rearranged.
fn relocate(
    fixed: &mut ManifestWrapperStateFixed,
    dynamic: &mut [u8],
    old: usize,
    new: usize,
    is_info: bool,
    allocated: usize,
    keep: &[u64],
    moved_heads: &mut Vec<(DataIndex, DataIndex)>,
) -> Result<(), ProgramError> {
    dynamic.copy_within(old..old + WRAPPER_BLOCK_SIZE, new);
    let old_index: DataIndex = old as DataIndex;
    let new_index: DataIndex = new as DataIndex;
    if is_info {
        let left: DataIndex = read_index(dynamic, new + NODE_LEFT);
        let right: DataIndex = read_index(dynamic, new + NODE_RIGHT);
        let parent: DataIndex = read_index(dynamic, new + NODE_PARENT);
        if left != NIL {
            validated_neighbor(left, allocated, keep)?;
            require!(
                read_index(dynamic, left as usize + NODE_PARENT) == old_index,
                ProgramError::InvalidAccountData,
                "Child at {} does not name its parent at {}",
                left,
                old_index
            )?;
            write_index(dynamic, left as usize + NODE_PARENT, new_index);
        }
        if right != NIL {
            validated_neighbor(right, allocated, keep)?;
            require!(
                read_index(dynamic, right as usize + NODE_PARENT) == old_index,
                ProgramError::InvalidAccountData,
                "Child at {} does not name its parent at {}",
                right,
                old_index
            )?;
            write_index(dynamic, right as usize + NODE_PARENT, new_index);
        }
        if parent != NIL {
            validated_neighbor(parent, allocated, keep)?;
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
            require!(
                fixed.market_infos_root_index == old_index,
                ProgramError::InvalidAccountData,
                "Market info at {} has no parent but is not the root",
                old_index
            )?;
            fixed.market_infos_root_index = new_index;
        }
    } else {
        let prev: DataIndex = read_index(dynamic, new + NODE_PARENT);
        let next: DataIndex = read_index(dynamic, new + NODE_RIGHT);
        if next != NIL {
            validated_neighbor(next, allocated, keep)?;
            require!(
                read_index(dynamic, next as usize + NODE_PARENT) == old_index,
                ProgramError::InvalidAccountData,
                "Order at {} is missing from its successor's links",
                old_index
            )?;
            write_index(dynamic, next as usize + NODE_PARENT, new_index);
        }
        if prev != NIL {
            validated_neighbor(prev, allocated, keep)?;
            require!(
                read_index(dynamic, prev as usize + NODE_RIGHT) == old_index,
                ProgramError::InvalidAccountData,
                "Order at {} is missing from its predecessor's links",
                old_index
            )?;
            write_index(dynamic, prev as usize + NODE_RIGHT, new_index);
        } else {
            // The capacity was reserved for the whole budget up front, so
            // this never reallocates.
            moved_heads.push((old_index, new_index));
        }
    }
    Ok(())
}

/// Compact the wrapper in place, relocating at most `limit` blocks (clamped
/// to `MAX_WRAPPER_DEFRAG_RELOCATIONS_PER_RUN`; absent means the full clamp),
/// and return the account size its remaining layout needs. Caller truncates
/// to that size after dropping borrows. A bounded run leaves a valid, no
/// larger account whose free list chains the holes still to be compacted;
/// repeating converges to a fully packed account with an empty free list.
pub fn defragment(wrapper_data: &mut [u8], limit: Option<u32>) -> Result<usize, ProgramError> {
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

    // Everything reachable survives; defrag never discards an entry. One
    // bitmap marks live blocks, the other tells the two node kinds apart,
    // because free-list blocks and list nodes both read as payload type zero.
    // `vec![0; n]` allocates exactly once at the final size.
    let words: usize = blocks.div_ceil(64);
    let mut keep: Vec<u64> = vec![0u64; words];
    let mut is_info: Vec<u64> = vec![0u64; words];

    mark_market_infos(
        dynamic,
        fixed.market_infos_root_index,
        allocated,
        &mut keep,
        &mut is_info,
    )?;

    // Convert any legacy orders tree to the list layout so relocation deals
    // with exactly two link shapes (nodes keep their addresses, so this
    // commutes with everything below), then mark each market's orders. The
    // conversion rewrites links through the root, so the root is bounds
    // checked before anything is written, and a head with a predecessor is a
    // root pointing into the middle of a list: walking it would silently drop
    // the earlier nodes, so it fails instead.
    for word_at in 0..words {
        let mut word: u64 = is_info[word_at];
        while word != 0 {
            let info_block: usize = word_at * 64 + word.trailing_zeros() as usize;
            word &= word - 1;
            let info_index: DataIndex = (info_block * WRAPPER_BLOCK_SIZE) as DataIndex;
            let orders_root: DataIndex = get_helper::<RBNode<MarketInfo>>(dynamic, info_index)
                .get_value()
                .orders_root_index;
            if orders_root != NIL {
                block_of(orders_root, allocated)?;
            }
            ensure_orders_list(dynamic, info_index);
            let head: DataIndex = get_helper::<RBNode<MarketInfo>>(dynamic, info_index)
                .get_value()
                .orders_root_index;
            if head != NIL {
                block_of(head, allocated)?;
                require!(
                    read_index(dynamic, head as usize + NODE_PARENT) == NIL,
                    ProgramError::InvalidAccountData,
                    "Order head at {} has a predecessor",
                    head
                )?;
            }
            let mut order_index: DataIndex = head;
            while order_index != NIL {
                let order_block: usize = block_of(order_index, allocated)?;
                require!(
                    !bit(&keep, order_block),
                    ProgramError::InvalidAccountData,
                    "Order at {} reached twice",
                    order_index
                )?;
                set_bit(&mut keep, order_block);
                order_index = read_index(dynamic, order_block * WRAPPER_BLOCK_SIZE + NODE_RIGHT);
            }
        }
    }

    // Slide each survivor, highest first, into the lowest hole beneath it.
    // Both cursors only ever advance, so one pass packs the survivors into
    // the low blocks; a budgeted pass packs the lowest holes and vacates the
    // highest survivors, which the truncation below reclaims either way.
    let max_relocations: u32 = limit
        .unwrap_or(MAX_WRAPPER_DEFRAG_RELOCATIONS_PER_RUN)
        .min(MAX_WRAPPER_DEFRAG_RELOCATIONS_PER_RUN);
    let mut moved_heads: Vec<(DataIndex, DataIndex)> = Vec::with_capacity(max_relocations as usize);
    let mut moves: u32 = 0;
    let mut hole: usize = 0;
    let mut block: usize = blocks;
    while block > 0 && moves < max_relocations {
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
            allocated,
            &keep,
            &mut moved_heads,
        )?;
        moves += 1;
        clear_bit(&mut keep, block);
        set_bit(&mut keep, hole);
        if moving_info {
            clear_bit(&mut is_info, block);
            set_bit(&mut is_info, hole);
        }
    }

    // Repoint the owning market info of every relocated list head, one bitmap
    // scan and one binary search per info instead of a scan per move. The
    // mark walk already proved each head is named by at most one market info,
    // so every fixup entry must be claimed exactly once.
    if !moved_heads.is_empty() {
        // Pushed highest block first; sort ascending for the search.
        moved_heads.sort_unstable();
        let mut repointed: usize = 0;
        for word_at in 0..words {
            let mut word: u64 = is_info[word_at];
            while word != 0 {
                let info_block: usize = word_at * 64 + word.trailing_zeros() as usize;
                word &= word - 1;
                let info_index: DataIndex = (info_block * WRAPPER_BLOCK_SIZE) as DataIndex;
                let info: &mut MarketInfo =
                    get_mut_helper::<RBNode<MarketInfo>>(dynamic, info_index).get_mut_value();
                if let Ok(found) =
                    moved_heads.binary_search_by_key(&info.orders_root_index, |&(from, _)| from)
                {
                    info.orders_root_index = moved_heads[found].1;
                    repointed += 1;
                }
            }
        }
        require!(
            repointed == moved_heads.len(),
            ProgramError::InvalidAccountData,
            "A relocated order head has no owning market info"
        )?;
    }

    // The new allocation ends after the highest survivor: everything above it
    // is an original hole or a block a survivor vacated this run. The free
    // list is rebuilt over the holes that remain below the cut, zeroed the
    // way every other free path leaves them; a full run leaves none.
    let mut new_blocks: usize = 0;
    for word_at in (0..words).rev() {
        if keep[word_at] != 0 {
            new_blocks = word_at * 64 + 63 - keep[word_at].leading_zeros() as usize + 1;
            break;
        }
    }
    let free_head: DataIndex = {
        let mut free_list: FreeList<UnusedWrapperFreeListPadding> = FreeList::new(dynamic, NIL);
        // Lowest block ends up at the head, so reuse packs before it grows.
        for hole_block in (0..new_blocks).rev() {
            if !bit(&keep, hole_block) {
                free_list.add((hole_block * WRAPPER_BLOCK_SIZE) as DataIndex);
            }
        }
        free_list.get_head()
    };
    fixed.free_list_head_index = free_head;
    fixed.num_bytes_allocated = (new_blocks * WRAPPER_BLOCK_SIZE) as u32;
    Ok(size_of::<ManifestWrapperStateFixed>() + new_blocks * WRAPPER_BLOCK_SIZE)
}

pub(crate) fn process_defrag(
    _program_id: &Pubkey,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // Optional little endian u32 budget: how many blocks this run relocates,
    // clamped to MAX_WRAPPER_DEFRAG_RELOCATIONS_PER_RUN. Absent means the
    // full clamp; an explicit zero relocates nothing but still truncates an
    // already-free tail and rebuilds the free list. Mirrors the core defrag:
    // a wrapper too fragmented for one transaction is compacted by repeating
    // a bounded run, each leaving a valid account no larger than it started.
    let limit: Option<u32> = match data.first_chunk::<4>() {
        Some(bytes) => {
            require!(
                data.len() == 4,
                ProgramError::InvalidInstructionData,
                "Defrag takes an optional u32 budget"
            )?;
            Some(u32::from_le_bytes(*bytes))
        }
        None => {
            require!(
                data.is_empty(),
                ProgramError::InvalidInstructionData,
                "Defrag takes an optional u32 budget"
            )?;
            None
        }
    };
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
    // Compaction keeps every entry and only rewrites internal addresses, but
    // it does move value: freed blocks stop being reusable prepaid capacity
    // and become excess lamports that `collect` sweeps to the collector, and
    // the owner pays rent again when a later insert grows the account. That
    // is the recovery model this instruction exists for; the owner may also
    // run it against their own wrapper ahead of a sweep.
    require!(
        *authority.pubkey() == trader || *authority.pubkey() == crate::COLLECTOR,
        ProgramError::InvalidArgument,
        "Defrag authority must be the wrapper owner or the collector"
    )?;
    let size: usize = {
        let mut wrapper_data = wrapper_state.info.try_borrow_mut()?;
        defragment(&mut wrapper_data, limit)?
    };
    wrapper_state.info.resize(size)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processors::shared::{
        expand_wrapper, MarketInfosTree, MarketInfosTreeReadOnly, OpenOrdersList,
        OpenOrdersListReadOnly, ORDERS_LAYOUT_LIST, ORDERS_LAYOUT_TREE,
    };
    use hypertree::{
        FreeListNode, HyperTreeReadOperations, HyperTreeWriteOperations, RedBlackTree,
    };
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
            index = get_helper::<FreeListNode<UnusedWrapperFreeListPadding>>(&data[FIXED..], index)
                .get_next_index();
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

        let size: usize = defragment(&mut data, None).unwrap();
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
        let again: usize = defragment(&mut data, None).unwrap();
        assert_eq!(again, size);
        assert_eq!(data, copy);
    }

    #[test]
    fn an_empty_wrapper_shrinks_to_its_header() {
        let mut data: Vec<u8> = wrapper(12);
        let size: usize = defragment(&mut data, None).unwrap();
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

        let size: usize = defragment(&mut data, None).unwrap();
        assert_eq!(size, FIXED + 6 * WRAPPER_BLOCK_SIZE);
        data.truncate(size);
        let mut ids: Vec<u64> = orders_of(&data, &market);
        ids.sort();
        assert_eq!(ids, vec![10, 11, 12, 13, 14]);
    }

    /// Budgeted runs each shrink the account and converge to the same packed
    /// layout a full run produces, leaving every entry intact in between, so
    /// an operator can compact an oversized wrapper one transaction at a time.
    #[test]
    fn bounded_runs_each_make_progress_and_converge() {
        let mut data: Vec<u8> = wrapper(40);
        let market_a: Pubkey = Pubkey::new_from_array([5; 32]);
        let market_b: Pubkey = Pubkey::new_from_array([6; 32]);
        let info_a: DataIndex = claim_market(&mut data, market_a);
        let o1: DataIndex = place(&mut data, info_a, 1);
        let o2: DataIndex = place(&mut data, info_a, 2);
        let info_b: DataIndex = claim_market(&mut data, market_b);
        let o3: DataIndex = place(&mut data, info_a, 3);
        let o4: DataIndex = place(&mut data, info_b, 4);
        let o5: DataIndex = place(&mut data, info_b, 5);
        let o6: DataIndex = place(&mut data, info_b, 6);
        cancel(&mut data, info_a, o1);
        cancel(&mut data, info_a, o3);
        cancel(&mut data, info_b, o5);
        let _ = (o2, o4, o6);
        let before_a: Vec<u64> = orders_of(&data, &market_a);
        let before_b: Vec<u64> = orders_of(&data, &market_b);

        let mut prev: usize = data.len();
        let mut runs: usize = 0;
        loop {
            let size: usize = defragment(&mut data, Some(1)).unwrap();
            data.truncate(size);
            // Each intermediate account is fully usable.
            assert_eq!(orders_of(&data, &market_a), before_a);
            assert_eq!(orders_of(&data, &market_b), before_b);
            assert!(size <= prev);
            if size == prev {
                break;
            }
            prev = size;
            runs += 1;
            assert!(runs < 40, "bounded runs failed to converge");
        }
        // Two market infos and three orders survive, fully packed.
        assert_eq!(prev, FIXED + 5 * WRAPPER_BLOCK_SIZE);
        assert_eq!(free_count(&data), 0);
        assert!(runs > 1, "budget of one should take several runs");
    }

    /// A zero budget relocates nothing but still truncates an already-free
    /// tail and rebuilds the free list over the remaining holes.
    #[test]
    fn a_zero_budget_reclaims_the_free_tail_without_moving() {
        let mut data: Vec<u8> = wrapper(10);
        // The free list hands out the highest blocks first; park the top four
        // so the live entries land low, then free the top again.
        let parked: Vec<DataIndex> = (0..4).map(|_| alloc(&mut data)).collect();
        let market: Pubkey = Pubkey::new_from_array([7; 32]);
        let info: DataIndex = claim_market(&mut data, market);
        let o1: DataIndex = place(&mut data, info, 1);
        let o2: DataIndex = place(&mut data, info, 2);
        let _ = o1;
        for index in parked {
            release(&mut data, index);
        }
        let before: Vec<u64> = orders_of(&data, &market);

        let size: usize = defragment(&mut data, Some(0)).unwrap();
        data.truncate(size);
        // The three entries sit in blocks 3..6, so the account keeps six
        // blocks: the tail is gone, the holes below the entries remain.
        assert_eq!(size, FIXED + 6 * WRAPPER_BLOCK_SIZE);
        assert_eq!(free_count(&data), 3);
        assert_eq!(orders_of(&data, &market), before);
        // Nothing moved, so the entries kept their addresses.
        assert_eq!(find_market(&data, &market), info);
        let _ = o2;

        // A follow-up full run finishes the job.
        let packed: usize = defragment(&mut data, None).unwrap();
        data.truncate(packed);
        assert_eq!(packed, FIXED + 3 * WRAPPER_BLOCK_SIZE);
        assert_eq!(free_count(&data), 0);
        assert_eq!(orders_of(&data, &market), before);
    }

    /// Account bytes past `num_bytes_allocated` are prepaid but unreachable
    /// by every wrapper path, so defrag reclaims them with the holes.
    #[test]
    fn reclaims_space_beyond_the_allocation() {
        let mut data: Vec<u8> = wrapper(8);
        let market: Pubkey = Pubkey::new_from_array([8; 32]);
        let info: DataIndex = claim_market(&mut data, market);
        let _o1: DataIndex = place(&mut data, info, 1);
        data.resize(data.len() + 2 * WRAPPER_BLOCK_SIZE, 0);

        let size: usize = defragment(&mut data, None).unwrap();
        assert_eq!(size, FIXED + 2 * WRAPPER_BLOCK_SIZE);
        data.truncate(size);
        assert_eq!(orders_of(&data, &market), vec![1]);
    }

    /// Compaction at a scale no single budget covers: many markets, every
    /// other block a hole, converging over repeated bounded runs.
    #[test]
    fn many_markets_compact_over_bounded_runs() {
        let markets: usize = 150;
        let mut data: Vec<u8> = wrapper(3 * markets + 10);
        let mut infos: Vec<(Pubkey, DataIndex)> = Vec::new();
        for at in 0..markets {
            let mut key: [u8; 32] = [0; 32];
            key[0] = (at % 256) as u8;
            key[1] = (at / 256) as u8;
            key[31] = 9;
            let market: Pubkey = Pubkey::new_from_array(key);
            let info: DataIndex = claim_market(&mut data, market);
            infos.push((market, info));
        }
        let mut cancels: Vec<(DataIndex, DataIndex)> = Vec::new();
        for (at, (_, info)) in infos.iter().enumerate() {
            let keep_order: DataIndex = place(&mut data, *info, at as u64 * 2);
            let drop_order: DataIndex = place(&mut data, *info, at as u64 * 2 + 1);
            let _ = keep_order;
            cancels.push((*info, drop_order));
        }
        for (info, drop_order) in cancels {
            cancel(&mut data, info, drop_order);
        }

        let mut prev: usize = data.len();
        let mut runs: usize = 0;
        loop {
            let size: usize = defragment(&mut data, Some(64)).unwrap();
            data.truncate(size);
            assert!(size <= prev);
            if size == prev {
                break;
            }
            prev = size;
            runs += 1;
            assert!(runs < 100, "bounded runs failed to converge");
        }
        assert_eq!(prev, FIXED + 2 * markets * WRAPPER_BLOCK_SIZE);
        assert_eq!(free_count(&data), 0);
        for (at, (market, _)) in infos.iter().enumerate() {
            assert_eq!(orders_of(&data, market), vec![at as u64 * 2]);
        }
    }

    /// A market info whose root points into the middle of a list would
    /// silently lose the earlier nodes; the head check rejects it instead.
    #[test]
    fn rejects_a_root_pointing_mid_list() {
        let mut data: Vec<u8> = wrapper(20);
        let market: Pubkey = Pubkey::new_from_array([10; 32]);
        let info: DataIndex = claim_market(&mut data, market);
        let interior: DataIndex = place(&mut data, info, 1);
        let _head: DataIndex = place(&mut data, info, 2);
        let (_, dynamic) = data.split_at_mut(FIXED);
        get_mut_helper::<RBNode<MarketInfo>>(dynamic, info)
            .get_mut_value()
            .orders_root_index = interior;
        assert_eq!(
            defragment(&mut data, None).unwrap_err(),
            ProgramError::InvalidAccountData
        );
    }

    /// An interior order whose predecessor link disagrees with its
    /// predecessor's successor link fails relocation's cross check.
    #[test]
    fn rejects_an_order_whose_predecessor_disagrees() {
        let mut data: Vec<u8> = wrapper(20);
        let market: Pubkey = Pubkey::new_from_array([11; 32]);
        let info: DataIndex = claim_market(&mut data, market);
        // Head is the latest placed: head -> middle -> tail.
        let tail: DataIndex = place(&mut data, info, 1);
        let middle: DataIndex = place(&mut data, info, 2);
        let _head: DataIndex = place(&mut data, info, 3);
        let (_, dynamic) = data.split_at_mut(FIXED);
        // The mark walk follows next links only, so this is first seen by
        // relocation, which refuses to write through it.
        write_index(dynamic, middle as usize + NODE_PARENT, tail);
        assert_eq!(
            defragment(&mut data, None).unwrap_err(),
            ProgramError::InvalidAccountData
        );
    }

    /// A tree child that does not name its parent back fails the walk before
    /// anything is converted or moved.
    #[test]
    fn rejects_a_tree_child_that_disowns_its_parent() {
        let mut data: Vec<u8> = wrapper(20);
        let info_a: DataIndex = claim_market(&mut data, Pubkey::new_from_array([12; 32]));
        let info_b: DataIndex = claim_market(&mut data, Pubkey::new_from_array([13; 32]));
        let (fixed_data, dynamic) = data.split_at_mut(FIXED);
        let fixed: &ManifestWrapperStateFixed = get_helper(fixed_data, 0);
        let child: DataIndex = if fixed.market_infos_root_index == info_a {
            info_b
        } else {
            info_a
        };
        write_index(dynamic, child as usize + NODE_PARENT, NIL);
        assert_eq!(
            defragment(&mut data, None).unwrap_err(),
            ProgramError::InvalidAccountData
        );
    }

    /// A market info naming a freed block as its orders root reads zeroed
    /// free-list bytes as links; the walk rejects it instead of keeping it.
    #[test]
    fn rejects_a_root_pointing_at_a_freed_block() {
        let mut data: Vec<u8> = wrapper(20);
        let market: Pubkey = Pubkey::new_from_array([4; 32]);
        let info: DataIndex = claim_market(&mut data, market);
        let first: DataIndex = place(&mut data, info, 1);
        let _second: DataIndex = place(&mut data, info, 2);
        cancel(&mut data, info, first);
        let (_, dynamic) = data.split_at_mut(FIXED);
        get_mut_helper::<RBNode<MarketInfo>>(dynamic, info)
            .get_mut_value()
            .orders_root_index = first;
        assert_eq!(
            defragment(&mut data, None).unwrap_err(),
            ProgramError::InvalidAccountData
        );
    }

    #[test]
    fn oversized_wrappers_are_rejected() {
        let mut data: Vec<u8> = wrapper(1);
        let fixed: &mut ManifestWrapperStateFixed = get_mut_helper(&mut data, 0);
        fixed.num_bytes_allocated = ((MAX_WRAPPER_DEFRAG_BLOCKS + 1) * WRAPPER_BLOCK_SIZE) as u32;
        let target: usize = FIXED + (MAX_WRAPPER_DEFRAG_BLOCKS + 1) * WRAPPER_BLOCK_SIZE;
        data.resize(target, 0);
        assert_eq!(
            defragment(&mut data, None).unwrap_err(),
            ProgramError::InvalidAccountData
        );
    }
}
