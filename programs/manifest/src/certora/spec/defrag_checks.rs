//! Account-backed defrag proofs, compiled as a child of `market::defrag` so
//! they can inspect its private layout without exporting production setters.
//!
//! The whole-pass rules quantify over all placements of three seats and three
//! orders in eight blocks, arbitrary balances/keys/order payloads, both sides,
//! and arbitrary relocation budgets. They are bounded proofs, not an induction
//! over every market size. No matching mock or defrag summary is used.
use super::*;
use crate::{cvt_vacuity_check, validation::AccountViewExt};
use cvt::{cvt_assert, cvt_assume};
use cvt_macros::rule;
use hypertree::{Color, RedBlackTreeReadOnly};
use nondet::nondet;
use pinocchio::account::{AccountView, RuntimeAccount};

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

fn collector_account() -> AccountView {
    // A valid wallet account header with arbitrary keys, balances and flags.
    // These rejection rules return before any account data is accessed.
    let header = Box::new(RuntimeAccount {
        borrow_state: u8::MAX,
        is_signer: u8::from(nondet::<bool>()),
        is_writable: u8::from(nondet::<bool>()),
        executable: u8::from(nondet::<bool>()),
        resize_delta: 0,
        address: arbitrary_key().to_bytes().into(),
        owner: arbitrary_key().to_bytes().into(),
        lamports: nondet(),
        data_len: 0,
    });
    // The allocation is deliberately retained for the lifetime of the rule.
    unsafe { AccountView::new_unchecked(Box::into_raw(header)) }
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

fn put_seat(market: &mut MarketValue, at: DataIndex, seat: ClaimedSeat) {
    let mut tree = RedBlackTree::new(
        &mut market.dynamic,
        market.fixed.claimed_seats_root_index,
        NIL,
    );
    tree.insert(at, seat);
    market.fixed.claimed_seats_root_index = tree.get_root_index();
    get_mut_helper::<RBNode<ClaimedSeat>>(&mut market.dynamic, at)
        .set_payload_type(MarketDataTreeNodeType::ClaimedSeat as u8);
}

fn put_order(market: &mut MarketValue, at: DataIndex, order: RestingOrder) {
    let bid = order.get_is_bid();
    let (root, best) = if bid {
        (
            &mut market.fixed.bids_root_index,
            &mut market.fixed.bids_best_index,
        )
    } else {
        (
            &mut market.fixed.asks_root_index,
            &mut market.fixed.asks_best_index,
        )
    };
    let mut tree = RedBlackTree::new(&mut market.dynamic, *root, *best);
    tree.insert(at, order);
    *root = tree.get_root_index();
    *best = tree.get_max_index();
    get_mut_helper::<RBNode<RestingOrder>>(&mut market.dynamic, at)
        .set_payload_type(MarketDataTreeNodeType::RestingOrder as u8);
}

fn market<const IS_BID: bool>() -> (MarketValue, [DataIndex; SEATS + ORDERS]) {
    let mut market = DynamicAccount {
        fixed: arbitrary_fixed(),
        dynamic: vec![0; BLOCKS * MARKET_BLOCK_SIZE],
    };
    market.fixed.num_bytes_allocated = index(BLOCKS);
    cvt_assume!(market.fixed.order_sequence_number < u64::MAX - 1);
    let indices = arbitrary_indices::<{ SEATS + ORDERS }>();
    let seats: [ClaimedSeat; SEATS] = [arbitrary_seat(), arbitrary_seat(), arbitrary_seat()];
    for i in 0..SEATS {
        for j in 0..i {
            cvt_assume!(seats[i].trader != seats[j].trader);
        }
        let mut seat = seats[i];
        if i == 2 {
            // A seat with neither a balance nor an order must be reclaimed.
            seat.base_withdrawable_balance = BaseAtoms::ZERO;
            seat.quote_withdrawable_balance = QuoteAtoms::ZERO;
        }
        put_seat(&mut market, indices[i], seat);
    }
    for i in 0..ORDERS {
        let owner = if nondet::<bool>() {
            indices[0]
        } else {
            indices[1]
        };
        let mut order = arbitrary_order(owner, if i == 2 { !IS_BID } else { IS_BID });
        cvt_assume!(order.get_sequence_number() < market.fixed.order_sequence_number);
        for j in 0..i {
            let previous = get_helper::<RBNode<RestingOrder>>(&market.dynamic, indices[SEATS + j]);
            cvt_assume!(order.get_sequence_number() != previous.value.get_sequence_number());
        }
        if i == 1 {
            // Equal-price orders exercise FIFO, which reinsertion could break.
            let previous = get_helper::<RBNode<RestingOrder>>(&market.dynamic, indices[SEATS]);
            order = RestingOrder::new(
                owner,
                order.get_num_base_atoms(),
                previous.value.get_price(),
                order.get_sequence_number(),
                0,
                IS_BID,
                order.get_order_type(),
            )
            .unwrap();
            order.set_reverse_spread(nondet());
        }
        put_order(&mut market, indices[SEATS + i], order);
    }
    // Construct the real free list; do not assume the desired postcondition.
    let mut head = NIL;
    for block in (0..BLOCKS).rev() {
        if market.dynamic[block * MARKET_BLOCK_SIZE + NODE_TYPE] == 0 {
            write_index(&mut market.dynamic, block * MARKET_BLOCK_SIZE, head);
            head = index(block);
        }
    }
    market.fixed.free_list_head_index = head;
    (market, indices)
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
/// roots/best nodes, and every free-list node. Identity is independent of index.
fn check_pass(
    market: &mut MarketValue,
    positions: &mut [DataIndex; SEATS + ORDERS],
    limit: Option<u32>,
) {
    let before = market.clone();
    let old_positions = *positions;
    let size = market.defragment(limit);
    // Unlike unwrap(), this is an explicit no-revert obligation.
    cvt_assert!(size.is_ok());
    let size = size.unwrap();
    cvt_assert!(size == MARKET_FIXED_SIZE + market.fixed.num_bytes_allocated as usize);
    cvt_assert!(market.fixed.num_bytes_allocated <= before.fixed.num_bytes_allocated);
    cvt_assert!(market.fixed.order_sequence_number == before.fixed.order_sequence_number + 1);
    let blocks = market.fixed.num_bytes_allocated as usize / MARKET_BLOCK_SIZE;
    let mut live = 0;
    let mut moved = 0;
    for i in 0..SEATS {
        if old_positions[i] == NIL {
            continue;
        }
        let old = get_helper::<RBNode<ClaimedSeat>>(&before.dynamic, old_positions[i]).value;
        let mut keep = old.base_withdrawable_balance != BaseAtoms::ZERO
            || old.quote_withdrawable_balance != QuoteAtoms::ZERO;
        for j in 0..ORDERS {
            let order =
                get_helper::<RBNode<RestingOrder>>(&before.dynamic, old_positions[SEATS + j]);
            keep |= order.value.get_trader_index() == old_positions[i];
        }
        let tree = RedBlackTreeReadOnly::<ClaimedSeat>::new(
            &market.dynamic,
            market.fixed.claimed_seats_root_index,
            NIL,
        );
        let at = tree.lookup_index(&old);
        positions[i] = at;
        if keep {
            cvt_assert!(at != NIL && at < market.fixed.num_bytes_allocated);
            let new = get_helper::<RBNode<ClaimedSeat>>(&market.dynamic, at).get_value();
            cvt_assert!(bytemuck::bytes_of(&old) == bytemuck::bytes_of(new));
            live += 1;
            moved += u32::from(at != old_positions[i]);
        } else {
            cvt_assert!(at == NIL);
        }
    }
    for i in 0..ORDERS {
        let old = get_helper::<RBNode<RestingOrder>>(&before.dynamic, old_positions[SEATS + i]);
        let mut found = NIL;
        for block in 0..blocks {
            if market.dynamic[block * MARKET_BLOCK_SIZE + NODE_TYPE]
                == MarketDataTreeNodeType::RestingOrder as u8
            {
                let order = get_helper::<RBNode<RestingOrder>>(&market.dynamic, index(block));
                if order.value.get_sequence_number() == old.value.get_sequence_number() {
                    cvt_assert!(found == NIL);
                    found = index(block);
                }
            }
        }
        cvt_assert!(found != NIL);
        positions[SEATS + i] = found;
        let new = get_helper::<RBNode<RestingOrder>>(&market.dynamic, found);
        let owner = mapped(
            old.value.get_trader_index(),
            &old_positions[..SEATS],
            &positions[..SEATS],
        );
        cvt_assert!(owner != NIL && new.value.get_trader_index() == owner);
        // Compare the full payload after normalizing its one relocated field.
        let mut expected = old.value;
        write_index(
            bytemuck::bytes_of_mut(&mut expected),
            ORDER_TRADER - NODE_VALUE,
            owner,
        );
        cvt_assert!(bytemuck::bytes_of(&expected) == bytemuck::bytes_of(&new.value));
        cvt_assert!(new.color == old.color && new.payload_type == old.payload_type);
        live += 1;
        moved += u32::from(found != old_positions[SEATS + i]);
    }
    for i in 0..ORDERS {
        let old = get_helper::<RBNode<RestingOrder>>(&before.dynamic, old_positions[SEATS + i]);
        let new = get_helper::<RBNode<RestingOrder>>(&market.dynamic, positions[SEATS + i]);
        cvt_assert!(new.left == mapped(old.left, &old_positions, positions));
        cvt_assert!(new.right == mapped(old.right, &old_positions, positions));
        cvt_assert!(new.parent == mapped(old.parent, &old_positions, positions));
    }
    cvt_assert!(
        market.fixed.bids_root_index
            == mapped(before.fixed.bids_root_index, &old_positions, positions)
    );
    cvt_assert!(
        market.fixed.asks_root_index
            == mapped(before.fixed.asks_root_index, &old_positions, positions)
    );
    cvt_assert!(
        market.fixed.bids_best_index
            == mapped(before.fixed.bids_best_index, &old_positions, positions)
    );
    cvt_assert!(
        market.fixed.asks_best_index
            == mapped(before.fixed.asks_best_index, &old_positions, positions)
    );
    // Every other fixed field (including the existing funds ghosts) is intact.
    let mut normalized = market.fixed;
    normalized.num_bytes_allocated = before.fixed.num_bytes_allocated;
    normalized.order_sequence_number = before.fixed.order_sequence_number;
    normalized.claimed_seats_root_index = before.fixed.claimed_seats_root_index;
    normalized.free_list_head_index = before.fixed.free_list_head_index;
    normalized.bids_root_index = before.fixed.bids_root_index;
    normalized.asks_root_index = before.fixed.asks_root_index;
    normalized.bids_best_index = before.fixed.bids_best_index;
    normalized.asks_best_index = before.fixed.asks_best_index;
    cvt_assert!(bytemuck::bytes_of(&normalized) == bytemuck::bytes_of(&before.fixed));
    let mut next = market.fixed.free_list_head_index;
    let mut free = 0;
    // Walking in address order proves uniqueness, completeness and termination.
    for block in 0..blocks {
        let at = index(block);
        let occupied = positions.iter().any(|p| *p == at);
        if !occupied {
            cvt_assert!(next == at);
            next = read_index(&market.dynamic, at as usize);
            cvt_assert!(
                market.dynamic[at as usize + 4..at as usize + MARKET_BLOCK_SIZE]
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
    // Exercise the same truncation boundary the processor uses.
    market.dynamic.truncate(size - MARKET_FIXED_SIZE);
}

fn preserves_market<const IS_BID: bool>() {
    let (mut market, mut positions) = market::<IS_BID>();
    let limit = if nondet::<bool>() {
        Some(nondet())
    } else {
        None
    };
    check_pass(&mut market, &mut positions, limit);
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
    let (mut market, mut positions) = market::<true>();
    check_pass(&mut market, &mut positions, Some(0));
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_repeated_passes() {
    let (mut market, mut positions) = market::<true>();
    check_pass(&mut market, &mut positions, Some(1));
    check_pass(&mut market, &mut positions, None);
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_empty_market() {
    let mut market = DynamicAccount {
        fixed: arbitrary_fixed(),
        dynamic: vec![0; BLOCKS * MARKET_BLOCK_SIZE],
    };
    market.fixed.num_bytes_allocated = index(BLOCKS);
    cvt_assume!(market.fixed.order_sequence_number < u64::MAX);
    let seat = ClaimedSeat::new_empty(arbitrary_key());
    put_seat(&mut market, index(5), seat);
    let result = market.defragment(None);
    cvt_assert!(result == Ok(MARKET_FIXED_SIZE + 2 * MARKET_BLOCK_SIZE));
    cvt_assert!(market.fixed.claimed_seats_root_index == NIL);
    cvt_assert!(market.fixed.free_list_head_index == 0);
    cvt_assert!(read_index(&market.dynamic, 0) == index(1));
    cvt_assert!(read_index(&market.dynamic, MARKET_BLOCK_SIZE) == NIL);
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_sequence_overflow_rejected() {
    let (mut market, _) = market::<true>();
    market.fixed.order_sequence_number = u64::MAX;
    cvt_assert!(market.defragment(None) == Err(ProgramError::ArithmeticOverflow));
    // Transaction rollback belongs to the runtime; do not claim that an Err
    // restores the in-memory state of this internal method.
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_bitmap_preserves_other_blocks() {
    // Symbolic word indices require heap storage in Certora's memory model.
    let mut words: Vec<u64> = vec![nondet(), nondet()];
    let before = words.clone();
    let target: usize = nondet();
    let other: usize = nondet();
    cvt_assume!(target < 128 && other < 128 && target != other);
    set_bit(&mut words, target);
    cvt_assert!(bit(&words, target));
    cvt_assert!(bit(&words, other) == bit(&before, other));
    clear_bit(&mut words, target);
    cvt_assert!(!bit(&words, target));
    cvt_assert!(bit(&words, other) == bit(&before, other));
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_relocate_seat_payload() {
    let mut fixed = arbitrary_fixed();
    let before = fixed;
    let mut dynamic = vec![0; BLOCKS * MARKET_BLOCK_SIZE];
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
    *get_mut_helper::<RBNode<ClaimedSeat>>(&mut dynamic, positions[0]) = node;
    let mut moved = Vec::with_capacity(1);
    let result = relocate(
        &mut fixed,
        &mut dynamic,
        positions[0] as usize,
        positions[1] as usize,
        &mut moved,
    );
    cvt_assert!(result.is_ok());
    cvt_assert!(bytemuck::bytes_of(&fixed) == bytemuck::bytes_of(&before));
    cvt_assert!(moved.len() == 1 && moved[0] == (positions[0], positions[1]));
    cvt_assert!(
        bytemuck::bytes_of(get_helper::<RBNode<ClaimedSeat>>(&dynamic, positions[1]).get_value())
            == bytemuck::bytes_of(&seat)
    );
    cvt_vacuity_check!();
}

fn relocate_order<const IS_BID: bool>() {
    let mut fixed = arbitrary_fixed();
    let mut dynamic = vec![0; BLOCKS * MARKET_BLOCK_SIZE];
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
    *get_mut_helper::<RBNode<RestingOrder>>(&mut dynamic, old) = node;
    let side = if nondet::<bool>() {
        NODE_LEFT
    } else {
        NODE_RIGHT
    };
    if parent != NIL {
        write_index(&mut dynamic, parent as usize + NODE_LEFT, NIL);
        write_index(&mut dynamic, parent as usize + NODE_RIGHT, NIL);
        write_index(&mut dynamic, parent as usize + side, old);
    }
    if left != NIL {
        write_index(&mut dynamic, left as usize + NODE_PARENT, old);
    }
    if right != NIL {
        write_index(&mut dynamic, right as usize + NODE_PARENT, old);
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
    cvt_assert!(relocate(
        &mut fixed,
        &mut dynamic,
        old as usize,
        new as usize,
        &mut moved
    )
    .is_ok());
    let actual = get_helper::<RBNode<RestingOrder>>(&dynamic, new);
    cvt_assert!(bytemuck::bytes_of(&actual.value) == bytemuck::bytes_of(&node.value));
    cvt_assert!(
        actual.color == node.color
            && actual.left == left
            && actual.right == right
            && actual.parent == parent
    );
    cvt_assert!(moved.is_empty());
    if left != NIL {
        cvt_assert!(read_index(&dynamic, left as usize + NODE_PARENT) == new);
    }
    if right != NIL {
        cvt_assert!(read_index(&dynamic, right as usize + NODE_PARENT) == new);
    }
    if parent != NIL {
        cvt_assert!(read_index(&dynamic, parent as usize + side) == new);
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
    let mut market = DynamicAccount {
        fixed: arbitrary_fixed(),
        dynamic: vec![0; BLOCKS * MARKET_BLOCK_SIZE],
    };
    cvt_assume!(
        market.fixed.num_bytes_allocated as usize > market.dynamic.len()
            || market.fixed.num_bytes_allocated as usize % MARKET_BLOCK_SIZE != 0
    );
    cvt_assert!(market.defragment(None) == Err(ProgramError::InvalidAccountData));
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_invalid_order_owner_rejected() {
    let (mut market, positions) = market::<true>();
    let owner: DataIndex = nondet();
    cvt_assume!(owner == NIL || owner >= index(BLOCKS) || owner as usize % MARKET_BLOCK_SIZE != 0);
    write_index(
        &mut market.dynamic,
        positions[SEATS] as usize + ORDER_TRADER,
        owner,
    );
    cvt_assert!(market.defragment(None) == Err(ProgramError::InvalidAccountData));
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
    let collector = collector_account();
    cvt_assume!(collector.is_writable() && collector.is_signer());
    cvt_assume!(*collector.pubkey() != crate::program::defrag::DEFRAG_COLLECTOR);
    let balance = collector.lamports();
    cvt_assert!(dispatch(&collector) == Err(ProgramError::InvalidArgument));
    cvt_assert!(collector.lamports() == balance);
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_requires_signature() {
    let collector = collector_account();
    cvt_assume!(collector.is_writable() && !collector.is_signer());
    cvt_assume!(*collector.pubkey() == crate::program::defrag::DEFRAG_COLLECTOR);
    cvt_assert!(dispatch(&collector) == Err(ProgramError::MissingRequiredSignature));
    cvt_vacuity_check!();
}

#[rule]
pub fn rule_defrag_requires_writable_collector() {
    let collector = collector_account();
    cvt_assume!(!collector.is_writable());
    cvt_assume!(collector.is_signer());
    cvt_assume!(*collector.pubkey() == crate::program::defrag::DEFRAG_COLLECTOR);
    cvt_assert!(dispatch(&collector) == Err(ProgramError::InvalidInstructionData));
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
