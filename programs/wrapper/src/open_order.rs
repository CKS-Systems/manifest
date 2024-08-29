use bytemuck::{Pod, Zeroable};
use hypertree::{DataIndex, PodBool, NIL};
use manifest::{
    quantities::{BaseAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{OrderType, NO_EXPIRATION_LAST_VALID_SLOT},
};
use static_assertions::const_assert_eq;
use std::{cmp::Ordering, mem::size_of};

use crate::processors::shared::WRAPPER_BLOCK_PAYLOAD_SIZE;

#[repr(C)]
#[derive(Default, Debug, Copy, Clone, Zeroable, Pod)]
pub struct WrapperOpenOrder {
    price: QuoteAtomsPerBaseAtom,
    client_order_id: u64,
    order_sequence_number: u64,
    num_base_atoms: BaseAtoms,
    market_data_index: DataIndex,
    last_valid_slot: u32,
    is_bid: PodBool,
    order_type: OrderType,

    _padding: [u8; 14],
}

// Blocks on wrapper are bigger than blocks on the market because there is more
// data to store here.

// 16 + // price
// 8 + // client_order_id
// 8 + // order_sequence_number
// 8 + // num_base_atoms
// 4 + // market_data_index
// 4 + // last_valid_slot
// 1 + // is_bid
// 1 + // order_type
// 14  // padding
// = 64
const_assert_eq!(size_of::<WrapperOpenOrder>(), WRAPPER_BLOCK_PAYLOAD_SIZE);
const_assert_eq!(size_of::<WrapperOpenOrder>() % 16, 0);

impl WrapperOpenOrder {
    /// Create a new WrapperOpenOrder.
    pub fn new(
        client_order_id: u64,
        order_sequence_number: u64,
        price: QuoteAtomsPerBaseAtom,
        num_base_atoms: u64,
        last_valid_slot: u32,
        market_data_index: DataIndex,
        is_bid: bool,
        order_type: OrderType,
    ) -> Self {
        WrapperOpenOrder {
            client_order_id,
            order_sequence_number,
            price,
            num_base_atoms: BaseAtoms::new(num_base_atoms),
            last_valid_slot,
            order_type,
            market_data_index,
            is_bid: PodBool::from_bool(is_bid),
            _padding: [0; 14],
        }
    }

    /// Create a new empty WrapperOpenOrder. Useful in tests.
    pub fn new_empty(client_order_id: u64) -> Self {
        WrapperOpenOrder {
            client_order_id,
            order_sequence_number: 0,
            price: QuoteAtomsPerBaseAtom::ZERO,
            num_base_atoms: BaseAtoms::ZERO,
            last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
            order_type: OrderType::Limit,
            market_data_index: NIL,
            is_bid: PodBool::from_bool(true),
            _padding: [0; 14],
        }
    }

    /// is_bid as a boolean.
    pub fn get_is_bid(&self) -> bool {
        self.is_bid.0 == 1
    }

    /// get the order sequence number from the market.
    pub fn get_order_sequence_number(&self) -> u64 {
        self.order_sequence_number
    }

    /// Get the DataIndex for the order in the core program.
    pub fn get_market_data_index(&self) -> DataIndex {
        self.market_data_index
    }

    /// Get the remaining number of base atoms in the order.
    pub fn get_num_base_atoms(&self) -> BaseAtoms {
        self.num_base_atoms
    }

    /// Get client defined order id for the order.
    pub fn get_client_order_id(&self) -> u64 {
        self.client_order_id
    }

    /// Get price on the order.
    pub fn get_price(&self) -> QuoteAtomsPerBaseAtom {
        self.price
    }

    /// Set whether the order is a bid or not.
    pub fn set_is_bid(&mut self, is_bid: bool) {
        self.is_bid = PodBool::from_bool(is_bid);
    }

    /// Set the price on an order.
    pub fn set_price(&mut self, price: QuoteAtomsPerBaseAtom) {
        self.price = price;
    }

    /// Update the number of remaining base atoms.
    pub fn update_remaining(&mut self, num_base_atoms: BaseAtoms) {
        self.num_base_atoms = num_base_atoms;
    }
}

impl Ord for WrapperOpenOrder {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.client_order_id).cmp(&(other.client_order_id))
    }
}

impl PartialOrd for WrapperOpenOrder {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for WrapperOpenOrder {
    fn eq(&self, other: &Self) -> bool {
        (self.client_order_id) == (other.client_order_id)
    }
}

impl Eq for WrapperOpenOrder {}

impl std::fmt::Display for WrapperOpenOrder {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.client_order_id)
    }
}

#[test]
fn test_display() {
    let open_order: WrapperOpenOrder = WrapperOpenOrder::new(
        0,
        0,
        1.0.try_into().unwrap(),
        0,
        0,
        0,
        false,
        OrderType::Limit,
    );
    format!("{}", open_order);
}

#[test]
fn test_cmp() {
    let open_order: WrapperOpenOrder = WrapperOpenOrder::new(
        0,
        0,
        1.0.try_into().unwrap(),
        0,
        0,
        0,
        false,
        OrderType::Limit,
    );
    let open_order2: WrapperOpenOrder = WrapperOpenOrder::new(
        1,
        0,
        1.0.try_into().unwrap(),
        0,
        0,
        0,
        false,
        OrderType::Limit,
    );
    assert!(open_order2 > open_order);
}
