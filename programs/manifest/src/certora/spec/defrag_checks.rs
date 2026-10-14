//! Account-backed defrag proofs, compiled as a child of `market::defrag` so
//! they can inspect its private layout without exporting production setters.
//!
//! The whole-pass rules quantify over all placements of three seats and three
//! orders in eight blocks, arbitrary balances/keys/order payloads, both sides,
//! and arbitrary relocation budgets. They are bounded proofs, not an induction
//! over every market size. No matching mock or defrag summary is used.
use super::*;
use crate::{cvt_static_initializer, cvt_vacuity_check, validation::AccountViewExt};
use cvt::{cvt_assert, cvt_assume};
use cvt_macros::rule;
use hypertree::{Color, RedBlackTreeReadOnly};
use nondet::{account_views_with_mem_layout, nondet};
use pinocchio::account::AccountView;

const BLOCKS: usize = 8;
const SEATS: usize = 3;
const ORDERS: usize = 3;

fn arbitrary_key() -> Pubkey {
    // Scalar nondet primitives are modeled directly by the prover. The legacy
    // 32-byte aggregate primitive has no memory-write summary in this version.
    let words: [u64; 4] = [nondet(), nondet(), nondet(), nondet()];
    Pubkey::new_from_array(bytemuck::cast(words))
}

fn arbitrary_fixed() -> MarketFixed {
    MarketFixed {
        discriminant: MARKET_FIXED_DISCRIMINANT,
        base_mint_decimals: nondet(),
        quote_mint_decimals: nondet(),
        base_vault_bump: nondet(),
        quote_vault_bump: nondet(),
        base_mint: arbitrary_key(),
        quote_mint: arbitrary_key(),
        base_vault: arbitrary_key(),
        quote_vault: arbitrary_key(),
        order_sequence_number: nondet(),
        num_bytes_allocated: nondet(),
        bids_root_index: NIL,
        bids_best_index: NIL,
        asks_root_index: NIL,
        asks_best_index: NIL,
        claimed_seats_root_index: NIL,
        quote_volume: QuoteAtoms::new(nondet()),
        withdrawable_base_atoms: BaseAtoms::new(nondet()),
        withdrawable_quote_atoms: QuoteAtoms::new(nondet()),
        orderbook_base_atoms: BaseAtoms::new(nondet()),
        orderbook_quote_atoms: QuoteAtoms::new(nondet()),
        ..MarketFixed::default()
    }
}

fn arbitrary_seat() -> ClaimedSeat {
    let mut seat = ClaimedSeat::new_empty(arbitrary_key());
    seat.base_withdrawable_balance = BaseAtoms::new(nondet());
    seat.quote_withdrawable_balance = QuoteAtoms::new(nondet());
    seat.quote_volume = QuoteAtoms::new(nondet());
    seat
}

// Dispatch rules take their collector from `account_views_with_mem_layout!`:
// a symbolic account pinned to the prover's input region, like every other
// rule's accounts. A heap-built header is outside the memory model's account
// layout and reads back havocked.

/// The market's dynamic bytes, zeroed, in the prover's pinned input region.
/// Heap-backed buffers are unusable here: block-sized copies into them are
/// havocked by the memory model, while account data is tracked byte-precisely.
fn zeroed_market_bytes(view: &AccountView) -> pinocchio::account::RefMut<'_, [u8]> {
    let borrow = view.try_borrow_mut();
    cvt_assume!(borrow.is_ok());
    let mut data = borrow.unwrap();
    cvt_assume!(data.len() >= BLOCKS * MARKET_BLOCK_SIZE);
    data.fill(0);
    data
}

/// Take the model's blocks as a slice whose length is a constant the prover
/// tracks. Assuming a symbolic `len()` equals the constant is not enough: the
/// bound stays symbolic and in-bounds block copies still report slice panics.
fn market_blocks(data: &mut [u8]) -> &mut [u8] {
    let (blocks, _) = data.split_at_mut(BLOCKS * MARKET_BLOCK_SIZE);
    blocks
}

/// Write a node into account bytes field by field. Whole-struct stores into
/// account data are havocked by the prover's memory model, so a rule that
/// reads the node back compares against havocked bytes.
fn put_node<V: hypertree::Payload>(dynamic: &mut [u8], at: DataIndex, node: RBNode<V>) {
    let slot: &mut RBNode<V> = get_mut_helper::<RBNode<V>>(dynamic, at);
    slot.left = node.left;
    slot.right = node.right;
    slot.parent = node.parent;
    slot.color = node.color;
    slot.payload_type = node.payload_type;
    slot._unused_padding = node._unused_padding;
    slot.value = node.value;
}

fn index(block: usize) -> DataIndex {
    (block * MARKET_BLOCK_SIZE) as DataIndex
}

fn arbitrary_indices<const N: usize>() -> [DataIndex; N] {
    let mut indices = [0; N];
    for i in 0..N {
        let block: usize = nondet();
        cvt_assume!(block < BLOCKS);
        indices[i] = index(block);
        for j in 0..i {
            cvt_assume!(indices[i] != indices[j]);
        }
    }
    indices
}

fn arbitrary_order(owner: DataIndex, is_bid: bool) -> RestingOrder {
    let order_type = match nondet::<u8>() % 5 {
        0 => OrderType::Limit,
        1 => OrderType::PostOnly,
        2 => OrderType::Global,
        3 => OrderType::Reverse,
        _ => OrderType::ReverseTight,
    };
    let mut order = RestingOrder::new(
        owner,
        BaseAtoms::new(nondet()),
        QuoteAtomsPerBaseAtom::nondet_price_u32(),
        nondet(),
        if order_type.is_reversible() {
            0
        } else {
            nondet()
        },
        is_bid,
        order_type,
    )
    .unwrap();
    order.set_reverse_spread(nondet());
    order
}

fn put_seat(fixed: &mut MarketFixed, dynamic: &mut [u8], at: DataIndex, seat: ClaimedSeat) {
    let mut tree = RedBlackTree::new(dynamic, fixed.claimed_seats_root_index, NIL);
    tree.insert(at, seat);
    fixed.claimed_seats_root_index = tree.get_root_index();
    get_mut_helper::<RBNode<ClaimedSeat>>(dynamic, at)
        .set_payload_type(MarketDataTreeNodeType::ClaimedSeat as u8);
}

fn put_order(fixed: &mut MarketFixed, dynamic: &mut [u8], at: DataIndex, order: RestingOrder) {
    let bid = order.get_is_bid();
    let (root, best) = if bid {
        (&mut fixed.bids_root_index, &mut fixed.bids_best_index)
    } else {
        (&mut fixed.asks_root_index, &mut fixed.asks_best_index)
    };
    let mut tree = RedBlackTree::new(dynamic, *root, *best);
    tree.insert(at, order);
    *root = tree.get_root_index();
    *best = tree.get_max_index();
    get_mut_helper::<RBNode<RestingOrder>>(dynamic, at)
        .set_payload_type(MarketDataTreeNodeType::RestingOrder as u8);
}

/// Build the symbolic market in `dynamic` (zeroed account bytes) and return
/// its fixed header plus the inserted values. Those stack copies are the
/// before-image the pass checks against: the prover's memory model havocks
/// heap snapshots, so there is no clone.
#[allow(clippy::type_complexity)]
fn market<const IS_BID: bool>(
    dynamic: &mut [u8],
) -> (
    MarketFixed,
    [DataIndex; SEATS + ORDERS],
    [ClaimedSeat; SEATS],
    [RestingOrder; ORDERS],
) {
    let mut fixed = arbitrary_fixed();
    fixed.num_bytes_allocated = index(BLOCKS);
    cvt_assume!(fixed.order_sequence_number < u64::MAX - 1);
    let indices = arbitrary_indices::<{ SEATS + ORDERS }>();
    let mut seats: [ClaimedSeat; SEATS] = [arbitrary_seat(), arbitrary_seat(), arbitrary_seat()];
    for i in 0..SEATS {
        for j in 0..i {
            cvt_assume!(seats[i].trader != seats[j].trader);
        }
        if i == 2 {
            // A seat with neither a balance nor an order must be reclaimed.
            seats[i].base_withdrawable_balance = BaseAtoms::ZERO;
            seats[i].quote_withdrawable_balance = QuoteAtoms::ZERO;
        }
        put_seat(&mut fixed, dynamic, indices[i], seats[i]);
    }
    let mut orders: [RestingOrder; ORDERS] = [
        arbitrary_order(indices[0], IS_BID),
        arbitrary_order(indices[0], IS_BID),
        arbitrary_order(indices[0], !IS_BID),
    ];
    for i in 0..ORDERS {
        let owner = if nondet::<bool>() {
            indices[0]
        } else {
            indices[1]
        };
        write_index(
            bytemuck::bytes_of_mut(&mut orders[i]),
            ORDER_TRADER - NODE_VALUE,
            owner,
        );
        cvt_assume!(orders[i].get_sequence_number() < fixed.order_sequence_number);
        for j in 0..i {
            cvt_assume!(orders[i].get_sequence_number() != orders[j].get_sequence_number());
        }
        if i == 1 {
            // Equal-price orders exercise FIFO, which reinsertion could break.
            let mut order = RestingOrder::new(
                owner,
                orders[1].get_num_base_atoms(),
                orders[0].get_price(),
                orders[1].get_sequence_number(),
                0,
                IS_BID,
                orders[1].get_order_type(),
            )
            .unwrap();
            order.set_reverse_spread(nondet());
            orders[1] = order;
        }
        put_order(&mut fixed, dynamic, indices[SEATS + i], orders[i]);
    }
    // Construct the real free list; do not assume the desired postcondition.
    let mut head = NIL;
    for block in (0..BLOCKS).rev() {
        if dynamic[block * MARKET_BLOCK_SIZE + NODE_TYPE] == 0 {
            write_index(dynamic, block * MARKET_BLOCK_SIZE, head);
            head = index(block);
        }
    }
    fixed.free_list_head_index = head;
    (fixed, indices, seats, orders)
}

fn mapped(at: DataIndex, before: &[DataIndex], after: &[DataIndex]) -> DataIndex {
    if at == NIL {
        return NIL;
    }
    for i in 0..before.len() {
        if before[i] == at {
            return after[i];
        }
    }
    cvt_assert!(false);
    NIL
}

/// Check every stored byte of a seat/order, the order-tree graph and cached
/// roots/best nodes, and every free-list node. Identity is independent of
/// index. The before-image lives in the callers' stack copies (`seats`,
/// `orders`, the returned fixed header) plus stack snapshots of the order
/// node headers taken here; `orders` is updated to the remapped owners so a
/// later pass checks against the right before-state. Returns the new size so
/// the caller can re-slice at the same truncation boundary the processor uses.
fn check_pass(
    fixed: &mut MarketFixed,
    dynamic: &mut [u8],
    positions: &mut [DataIndex; SEATS + ORDERS],
    seats: &[ClaimedSeat; SEATS],
    orders: &mut [RestingOrder; ORDERS],
    limit: Option<u32>,
) -> usize {
    let before = *fixed;
    let old_positions = *positions;
    let mut old_links: [(DataIndex, DataIndex, DataIndex); ORDERS] = [(NIL, NIL, NIL); ORDERS];
    let mut old_colors: [Color; ORDERS] = [Color::Red; ORDERS];
    let mut old_payload_types: [u8; ORDERS] = [0; ORDERS];
    for i in 0..ORDERS {
        let node = get_helper::<RBNode<RestingOrder>>(dynamic, old_positions[SEATS + i]);
        old_links[i] = (node.left, node.right, node.parent);
        old_colors[i] = node.color;
        old_payload_types[i] = node.payload_type;
    }
    let mut account = DynamicAccount {
        fixed: &mut *fixed,
        dynamic: &mut *dynamic,
    };
    let size = account.defragment(limit);
    // Unlike unwrap(), this is an explicit no-revert obligation.
    cvt_assert!(size.is_ok());
    let size = size.unwrap();
    cvt_assert!(size == MARKET_FIXED_SIZE + fixed.num_bytes_allocated as usize);
    cvt_assert!(fixed.num_bytes_allocated <= before.num_bytes_allocated);
    cvt_assert!(fixed.order_sequence_number == before.order_sequence_number + 1);
    let blocks = fixed.num_bytes_allocated as usize / MARKET_BLOCK_SIZE;
    let mut live = 0;
    let mut moved = 0;
    for i in 0..SEATS {
        if old_positions[i] == NIL {
            continue;
        }
        let old = &seats[i];
        let mut keep = old.base_withdrawable_balance != BaseAtoms::ZERO
            || old.quote_withdrawable_balance != QuoteAtoms::ZERO;
        for j in 0..ORDERS {
            keep |= orders[j].get_trader_index() == old_positions[i];
        }
        let tree = RedBlackTreeReadOnly::<ClaimedSeat>::new(
            &*dynamic,
            fixed.claimed_seats_root_index,
            NIL,
        );
        let at = tree.lookup_index(old);
        positions[i] = at;
        if keep {
            cvt_assert!(at != NIL && at < fixed.num_bytes_allocated);
            let new = get_helper::<RBNode<ClaimedSeat>>(dynamic, at).get_value();
            cvt_assert!(bytemuck::bytes_of(old) == bytemuck::bytes_of(new));
            live += 1;
            moved += u32::from(at != old_positions[i]);
        } else {
            cvt_assert!(at == NIL);
        }
    }
    for i in 0..ORDERS {
        let old = orders[i];
        let mut found = NIL;
        for block in 0..blocks {
            if dynamic[block * MARKET_BLOCK_SIZE + NODE_TYPE]
                == MarketDataTreeNodeType::RestingOrder as u8
            {
                let order = get_helper::<RBNode<RestingOrder>>(dynamic, index(block));
                if order.value.get_sequence_number() == old.get_sequence_number() {
                    cvt_assert!(found == NIL);
                    found = index(block);
                }
            }
        }
        cvt_assert!(found != NIL);
        positions[SEATS + i] = found;
        let new = get_helper::<RBNode<RestingOrder>>(dynamic, found);
        let owner = mapped(
            old.get_trader_index(),
            &old_positions[..SEATS],
            &positions[..SEATS],
        );
        cvt_assert!(owner != NIL && new.value.get_trader_index() == owner);
        // Compare the full payload after normalizing its one relocated field.
        let mut expected = old;
        write_index(
            bytemuck::bytes_of_mut(&mut expected),
            ORDER_TRADER - NODE_VALUE,
            owner,
        );
        cvt_assert!(bytemuck::bytes_of(&expected) == bytemuck::bytes_of(&new.value));
        cvt_assert!(new.color == old_colors[i] && new.payload_type == old_payload_types[i]);
        live += 1;
        moved += u32::from(found != old_positions[SEATS + i]);
        orders[i] = expected;
    }
    for i in 0..ORDERS {
        let new = get_helper::<RBNode<RestingOrder>>(dynamic, positions[SEATS + i]);
        cvt_assert!(new.left == mapped(old_links[i].0, &old_positions, positions));
        cvt_assert!(new.right == mapped(old_links[i].1, &old_positions, positions));
        cvt_assert!(new.parent == mapped(old_links[i].2, &old_positions, positions));
    }
    cvt_assert!(fixed.bids_root_index == mapped(before.bids_root_index, &old_positions, positions));
    cvt_assert!(fixed.asks_root_index == mapped(before.asks_root_index, &old_positions, positions));
    cvt_assert!(fixed.bids_best_index == mapped(before.bids_best_index, &old_positions, positions));
    cvt_assert!(fixed.asks_best_index == mapped(before.asks_best_index, &old_positions, positions));
    // Every other fixed field (including the existing funds ghosts) is intact.
    let mut normalized = *fixed;
    normalized.num_bytes_allocated = before.num_bytes_allocated;
    normalized.order_sequence_number = before.order_sequence_number;
    normalized.claimed_seats_root_index = before.claimed_seats_root_index;
    normalized.free_list_head_index = before.free_list_head_index;
    normalized.bids_root_index = before.bids_root_index;
    normalized.asks_root_index = before.asks_root_index;
    normalized.bids_best_index = before.bids_best_index;
    normalized.asks_best_index = before.asks_best_index;
    cvt_assert!(bytemuck::bytes_of(&normalized) == bytemuck::bytes_of(&before));
    let mut next = fixed.free_list_head_index;
    let mut free = 0;
    // Walking in address order proves uniqueness, completeness and termination.
    for block in 0..blocks {
        let at = index(block);
        let occupied = positions.iter().any(|p| *p == at);
        if !occupied {
            cvt_assert!(next == at);
            next = read_index(dynamic, at as usize);
            cvt_assert!(
                dynamic[at as usize + 4..at as usize + MARKET_BLOCK_SIZE]
                    == [0; MARKET_BLOCK_SIZE - 4]
            );
            free += 1;
        }
    }
    cvt_assert!(next == NIL && free >= 2 && free + live == blocks);
    if let Some(budget) = limit {
        cvt_assert!(moved <= budget);
    } else {
        cvt_assert!(free == 2);
    }
    size
}

fn preserves_market<const IS_BID: bool>() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic: &mut [u8] = &mut data;
    let (mut fixed, mut positions, seats, mut orders) = market::<IS_BID>(dynamic);
    let limit = if nondet::<bool>() {
        Some(nondet())
    } else {
        None
    };
    check_pass(
        &mut fixed,
        dynamic,
        &mut positions,
        &seats,
        &mut orders,
        limit,
    );
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_preserves_market_bid() {
    preserves_market::<true>();
}
#[rule]
pub fn rule_defrag_preserves_market_ask() {
    preserves_market::<false>();
}

#[rule]
pub fn rule_defrag_zero_budget() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic: &mut [u8] = &mut data;
    let (mut fixed, mut positions, seats, mut orders) = market::<true>(dynamic);
    check_pass(
        &mut fixed,
        dynamic,
        &mut positions,
        &seats,
        &mut orders,
        Some(0),
    );
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_repeated_passes() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic: &mut [u8] = &mut data;
    let (mut fixed, mut positions, seats, mut orders) = market::<true>(dynamic);
    let size = check_pass(
        &mut fixed,
        dynamic,
        &mut positions,
        &seats,
        &mut orders,
        Some(1),
    );
    // Exercise the same truncation boundary the processor uses.
    let (dynamic, _) = dynamic.split_at_mut(size - MARKET_FIXED_SIZE);
    check_pass(
        &mut fixed,
        dynamic,
        &mut positions,
        &seats,
        &mut orders,
        None,
    );
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_empty_market() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic: &mut [u8] = &mut data;
    let mut fixed = arbitrary_fixed();
    fixed.num_bytes_allocated = index(BLOCKS);
    cvt_assume!(fixed.order_sequence_number < u64::MAX);
    let seat = ClaimedSeat::new_empty(arbitrary_key());
    put_seat(&mut fixed, dynamic, index(5), seat);
    let mut account = DynamicAccount {
        fixed: &mut fixed,
        dynamic: &mut *dynamic,
    };
    let result = account.defragment(None);
    cvt_assert!(result == Ok(MARKET_FIXED_SIZE + 2 * MARKET_BLOCK_SIZE));
    cvt_assert!(fixed.claimed_seats_root_index == NIL);
    cvt_assert!(fixed.free_list_head_index == 0);
    cvt_assert!(read_index(dynamic, 0) == index(1));
    cvt_assert!(read_index(dynamic, MARKET_BLOCK_SIZE) == NIL);
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_sequence_overflow_rejected() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic: &mut [u8] = &mut data;
    let (mut fixed, _, _, _) = market::<true>(dynamic);
    fixed.order_sequence_number = u64::MAX;
    let mut account = DynamicAccount {
        fixed: &mut fixed,
        dynamic,
    };
    cvt_assert!(account.defragment(None) == Err(ProgramError::ArithmeticOverflow));
    // Transaction rollback belongs to the runtime; do not claim that an Err
    // restores the in-memory state of this internal method.
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_bitmap_preserves_other_blocks() {
    // Symbolic word indices require heap storage in Certora's memory model.
    // The before-image is kept in scalars: a heap-to-heap clone is havocked
    // by the prover's memory model and cannot serve as a snapshot.
    let (word0, word1): (u64, u64) = (nondet(), nondet());
    let mut words: Vec<u64> = vec![word0, word1];
    let target: usize = nondet();
    let other: usize = nondet();
    cvt_assume!(target < 128 && other < 128 && target != other);
    // Constant indices only: symbolic stack indexing is also unsupported.
    let expected: bool = (if other < 64 { word0 } else { word1 }) >> (other % 64) & 1 == 1;
    set_bit(&mut words, target);
    cvt_assert!(bit(&words, target));
    cvt_assert!(bit(&words, other) == expected);
    clear_bit(&mut words, target);
    cvt_assert!(!bit(&words, target));
    cvt_assert!(bit(&words, other) == expected);
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_relocate_seat_payload() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut fixed = arbitrary_fixed();
    let before = fixed;
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic = market_blocks(&mut data);
    let positions = arbitrary_indices::<2>();
    cvt_assume!(positions[1] < positions[0]);
    let seat = arbitrary_seat();
    let node = RBNode {
        left: nondet(),
        right: nondet(),
        parent: nondet(),
        color: nondet(),
        payload_type: MarketDataTreeNodeType::ClaimedSeat as u8,
        _unused_padding: 0,
        value: seat,
    };
    put_node::<ClaimedSeat>(dynamic, positions[0], node);
    let mut moved = Vec::with_capacity(1);
    let result = relocate(
        &mut fixed,
        dynamic,
        positions[0] as usize,
        positions[1] as usize,
        &mut moved,
    );
    cvt_assert!(result.is_ok());
    cvt_assert!(bytemuck::bytes_of(&fixed) == bytemuck::bytes_of(&before));
    cvt_assert!(moved.len() == 1 && moved[0] == (positions[0], positions[1]));
    cvt_assert!(
        bytemuck::bytes_of(get_helper::<RBNode<ClaimedSeat>>(dynamic, positions[1]).get_value())
            == bytemuck::bytes_of(&seat)
    );
    cvt_vacuity_check!();
}

fn relocate_order<const IS_BID: bool>() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut fixed = arbitrary_fixed();
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic = market_blocks(&mut data);
    let p = arbitrary_indices::<5>();
    let (old, new) = (p[0], p[1]);
    cvt_assume!(new < old);
    let left = if nondet::<bool>() { p[2] } else { NIL };
    let right = if nondet::<bool>() { p[3] } else { NIL };
    let parent = if nondet::<bool>() { p[4] } else { NIL };
    let node = RBNode {
        left,
        right,
        parent,
        color: nondet::<Color>(),
        payload_type: MarketDataTreeNodeType::RestingOrder as u8,
        _unused_padding: 0,
        value: arbitrary_order(index(7), IS_BID),
    };
    put_node::<RestingOrder>(dynamic, old, node);
    let side = if nondet::<bool>() {
        NODE_LEFT
    } else {
        NODE_RIGHT
    };
    if parent != NIL {
        write_index(dynamic, parent as usize + NODE_LEFT, NIL);
        write_index(dynamic, parent as usize + NODE_RIGHT, NIL);
        write_index(dynamic, parent as usize + side, old);
    }
    if left != NIL {
        write_index(dynamic, left as usize + NODE_PARENT, old);
    }
    if right != NIL {
        write_index(dynamic, right as usize + NODE_PARENT, old);
    }
    if IS_BID {
        fixed.bids_root_index = if parent == NIL { old } else { parent };
    } else {
        fixed.asks_root_index = if parent == NIL { old } else { parent };
    }
    let best = if nondet::<bool>() { old } else { NIL };
    if IS_BID {
        fixed.bids_best_index = best;
    } else {
        fixed.asks_best_index = best;
    }
    let before = fixed;
    let mut moved = Vec::new();
    cvt_assert!(relocate(&mut fixed, dynamic, old as usize, new as usize, &mut moved).is_ok());
    let actual = get_helper::<RBNode<RestingOrder>>(dynamic, new);
    cvt_assert!(bytemuck::bytes_of(&actual.value) == bytemuck::bytes_of(&node.value));
    cvt_assert!(
        actual.color == node.color
            && actual.left == left
            && actual.right == right
            && actual.parent == parent
    );
    cvt_assert!(moved.is_empty());
    if left != NIL {
        cvt_assert!(read_index(dynamic, left as usize + NODE_PARENT) == new);
    }
    if right != NIL {
        cvt_assert!(read_index(dynamic, right as usize + NODE_PARENT) == new);
    }
    if parent != NIL {
        cvt_assert!(read_index(dynamic, parent as usize + side) == new);
    }
    let expected_root = if parent == NIL { new } else { parent };
    let expected_best = if best == old { new } else { best };
    if IS_BID {
        cvt_assert!(
            fixed.bids_root_index == expected_root && fixed.bids_best_index == expected_best
        );
        cvt_assert!(
            fixed.asks_root_index == before.asks_root_index
                && fixed.asks_best_index == before.asks_best_index
        );
    } else {
        cvt_assert!(
            fixed.asks_root_index == expected_root && fixed.asks_best_index == expected_best
        );
        cvt_assert!(
            fixed.bids_root_index == before.bids_root_index
                && fixed.bids_best_index == before.bids_best_index
        );
    }
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_relocate_order_bid() {
    relocate_order::<true>();
}
#[rule]
pub fn rule_defrag_relocate_order_ask() {
    relocate_order::<false>();
}

#[rule]
pub fn rule_defrag_invalid_allocation_rejected() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic: &mut [u8] = &mut data;
    let mut fixed = arbitrary_fixed();
    cvt_assume!(
        fixed.num_bytes_allocated as usize > dynamic.len()
            || fixed.num_bytes_allocated as usize % MARKET_BLOCK_SIZE != 0
    );
    let mut account = DynamicAccount {
        fixed: &mut fixed,
        dynamic,
    };
    cvt_assert!(account.defragment(None) == Err(ProgramError::InvalidAccountData));
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_invalid_order_owner_rejected() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let mut data = zeroed_market_bytes(&accounts[1]);
    let dynamic: &mut [u8] = &mut data;
    let (mut fixed, positions, _, _) = market::<true>(dynamic);
    let owner: DataIndex = nondet();
    cvt_assume!(owner == NIL || owner >= index(BLOCKS) || owner as usize % MARKET_BLOCK_SIZE != 0);
    write_index(dynamic, positions[SEATS] as usize + ORDER_TRADER, owner);
    let mut account = DynamicAccount {
        fixed: &mut fixed,
        dynamic,
    };
    cvt_assert!(account.defragment(None) == Err(ProgramError::InvalidAccountData));
    cvt_vacuity_check!();
}

fn dispatch(collector: &AccountView) -> Result<(), ProgramError> {
    let budget: u32 = nondet();
    let bytes = budget.to_le_bytes();
    let data = [
        crate::program::ManifestInstruction::Defrag as u8,
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
    ];
    let len = if nondet::<bool>() { 1 } else { 5 };
    crate::process_instruction(
        crate::validation::as_raw_key(&crate::id()),
        std::slice::from_ref(collector),
        &data[..len],
    )
}

#[rule]
pub fn rule_defrag_requires_collector() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let collector: &AccountView = &accounts[0];
    cvt_assume!(collector.is_writable() && collector.is_signer());
    cvt_assume!(*collector.pubkey() != crate::program::defrag::DEFRAG_COLLECTOR);
    let balance = collector.lamports();
    cvt_assert!(dispatch(collector) == Err(ProgramError::InvalidArgument));
    cvt_assert!(collector.lamports() == balance);
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_requires_signature() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let collector: &AccountView = &accounts[0];
    cvt_assume!(collector.is_writable() && !collector.is_signer());
    cvt_assume!(*collector.pubkey() == crate::program::defrag::DEFRAG_COLLECTOR);
    cvt_assert!(dispatch(collector) == Err(ProgramError::MissingRequiredSignature));
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_requires_writable_collector() {
    cvt_static_initializer!();
    let accounts: [AccountView; 16] = account_views_with_mem_layout!();
    let collector: &AccountView = &accounts[0];
    cvt_assume!(!collector.is_writable());
    cvt_assume!(collector.is_signer());
    cvt_assume!(*collector.pubkey() == crate::program::defrag::DEFRAG_COLLECTOR);
    cvt_assert!(dispatch(collector) == Err(ProgramError::InvalidInstructionData));
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_invalid_instruction_data_rejected() {
    // Covers truncated and trailing budgets before any account is read.
    let data: [u8; 5] = [nondet(), nondet(), nondet(), nondet(), nondet()];
    let len: usize = nondet();
    cvt_assume!(len > 0 && len <= data.len() && len != 4);
    cvt_assert!(
        crate::program::defrag::process_defrag(&crate::id(), &[], &data[..len])
            == Err(ProgramError::InvalidInstructionData)
    );
    cvt_vacuity_check!();
}
