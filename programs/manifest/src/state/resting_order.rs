use std::mem::size_of;

use crate::quantities::{BaseAtoms, EffectivePrice, QuoteAtomsPerBaseAtom};
use borsh::{BorshDeserialize, BorshSerialize};
use bytemuck::{Pod, Zeroable};
use hypertree::{DataIndex, PodBool};
use num_enum::{IntoPrimitive, TryFromPrimitive};
use shank::ShankType;
use solana_program::{entrypoint::ProgramResult, program_error::ProgramError};
use static_assertions::const_assert_eq;
use std::cmp::Ordering;

use super::{constants::NO_EXPIRATION_LAST_VALID_SLOT, RESTING_ORDER_SIZE};

#[derive(
    Debug,
    BorshDeserialize,
    BorshSerialize,
    PartialEq,
    Clone,
    Copy,
    ShankType,
    IntoPrimitive,
    TryFromPrimitive,
)]
#[repr(u8)]
pub enum OrderType {
    // Normal limit order.
    Limit = 0,

    // Does not rest. Take only.
    ImmediateOrCancel = 1,

    // Fails if would cross the orderbook.
    PostOnly = 2,

    // Like a post only but slides to a zero spread rather than fail.
    PostOnlySlide = 3,

    // Global orders are post only but use funds from the global account.
    Global = 4,
}
unsafe impl bytemuck::Zeroable for OrderType {}
unsafe impl bytemuck::Pod for OrderType {}
impl Default for OrderType {
    fn default() -> Self {
        OrderType::Limit
    }
}

pub fn order_type_can_rest(order_type: OrderType) -> bool {
    order_type != OrderType::ImmediateOrCancel
}

pub fn order_type_can_take(order_type: OrderType) -> bool {
    order_type != OrderType::PostOnly && order_type != OrderType::Global
}

#[repr(C)]
#[derive(Default, Debug, Copy, Clone, Zeroable, Pod)]
pub struct RestingOrder {
    price: QuoteAtomsPerBaseAtom,
    // Sort key is the worst effective price someone could get by
    // trading with me due to the rounding being in my favor as a maker.
    effective_price: EffectivePrice,
    num_base_atoms: BaseAtoms,
    sequence_number: u64,
    trader_index: DataIndex,
    last_valid_slot: u32,
    is_bid: PodBool,
    order_type: OrderType,
    _padding: [u8; 6],
}

// 16 +  // price
// 16 +  // effective_price
//  8 +  // num_base_atoms
//  8 +  // sequence_number
//  4 +  // trader_index
//  4 +  // last_valid_slot
//  1 +  // is_bid
//  1 +  // order_type
//  6    // padding
// = 64
const_assert_eq!(size_of::<RestingOrder>(), RESTING_ORDER_SIZE);
const_assert_eq!(size_of::<RestingOrder>() % 8, 0);

impl RestingOrder {
    pub fn new(
        trader_index: DataIndex,
        num_base_atoms: BaseAtoms,
        price: QuoteAtomsPerBaseAtom,
        sequence_number: u64,
        last_valid_slot: u32,
        is_bid: bool,
        order_type: OrderType,
    ) -> Result<Self, ProgramError> {
        Ok(RestingOrder {
            trader_index,
            num_base_atoms,
            last_valid_slot,
            price,
            effective_price: price.checked_effective_price(num_base_atoms, is_bid)?,
            sequence_number,
            is_bid: PodBool::from_bool(is_bid),
            order_type,
            _padding: [0; 6],
        })
    }

    pub fn get_trader_index(&self) -> DataIndex {
        self.trader_index
    }

    pub fn get_num_base_atoms(&self) -> BaseAtoms {
        self.num_base_atoms
    }

    pub fn get_price(&self) -> QuoteAtomsPerBaseAtom {
        self.price
    }

    pub fn get_effective_price(&self) -> EffectivePrice {
        self.effective_price
    }

    #[cfg(any(test, feature = "no-clock"))]
    pub fn set_sequence_number(&mut self, sequence_number: u64) {
        self.sequence_number = sequence_number;
    }
    #[cfg(any(test, feature = "no-clock"))]
    pub fn set_last_valid_slot(&mut self, last_valid_slot: u32) {
        self.last_valid_slot = last_valid_slot;
    }

    pub fn get_order_type(&self) -> OrderType {
        self.order_type
    }

    pub fn is_global(&self) -> bool {
        self.order_type == OrderType::Global
    }

    pub fn get_sequence_number(&self) -> u64 {
        self.sequence_number
    }

    pub fn is_expired(&self, current_slot: u32) -> bool {
        self.last_valid_slot != NO_EXPIRATION_LAST_VALID_SLOT && self.last_valid_slot < current_slot
    }

    pub fn get_is_bid(&self) -> bool {
        self.is_bid.0 == 1
    }

    pub fn reduce(&mut self, size: BaseAtoms) -> ProgramResult {
        self.num_base_atoms = self.num_base_atoms.checked_sub(size)?;
        self.effective_price = self
            .price
            .checked_effective_price(self.num_base_atoms, self.get_is_bid())?;
        Ok(())
    }
}

impl Ord for RestingOrder {
    fn cmp(&self, other: &Self) -> Ordering {
        // We only compare bids with bids or asks with asks. If you want to
        // check if orders match, directly access their prices.
        debug_assert!(self.get_is_bid() == other.get_is_bid());

        if self.get_is_bid() {
            (self.effective_price).cmp(&(other.effective_price))
        } else {
            (other.effective_price).cmp(&(self.effective_price))
        }
    }
}

impl PartialOrd for RestingOrder {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for RestingOrder {
    fn eq(&self, other: &Self) -> bool {
        (self.effective_price) == (other.effective_price)
    }
}

impl Eq for RestingOrder {}

impl std::fmt::Display for RestingOrder {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}@{}", self.num_base_atoms, self.price)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::quantities::WrapperU64;

    #[test]
    fn test_default() {
        assert_eq!(OrderType::default(), OrderType::Limit);
    }

    #[test]
    fn test_display() {
        let resting_order: RestingOrder = RestingOrder::new(
            0,
            BaseAtoms::ZERO,
            QuoteAtomsPerBaseAtom::ZERO,
            0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            true,
            OrderType::Limit,
        )
        .unwrap();
        format!("{}", resting_order);
    }

    #[test]
    fn test_cmp() {
        let resting_order_1: RestingOrder = RestingOrder::new(
            0,
            BaseAtoms::new(1),
            QuoteAtomsPerBaseAtom::try_from(1.0).unwrap(),
            0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            false,
            OrderType::Limit,
        )
        .unwrap();
        // This is better because the effective price for the other is 2.
        let resting_order_2: RestingOrder = RestingOrder::new(
            0,
            BaseAtoms::new(1_000_000_000),
            QuoteAtomsPerBaseAtom::try_from(1.01).unwrap(),
            0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            false,
            OrderType::Limit,
        )
        .unwrap();
        assert!(resting_order_1 > resting_order_2);
        assert!(resting_order_1 != resting_order_2);

        let resting_order_1: RestingOrder = RestingOrder::new(
            0,
            BaseAtoms::new(1),
            QuoteAtomsPerBaseAtom::try_from(1.00000000000001).unwrap(),
            0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            false,
            OrderType::Limit,
        )
        .unwrap();
        // This is better because the effective price for the other is 2.
        let resting_order_2: RestingOrder = RestingOrder::new(
            0,
            BaseAtoms::new(1_000_000_000),
            QuoteAtomsPerBaseAtom::try_from(1.01).unwrap(),
            0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            false,
            OrderType::Limit,
        )
        .unwrap();
        assert!(resting_order_1 < resting_order_2);
        assert!(resting_order_1 != resting_order_2);
    }

    #[test]
    fn test_setters() {
        let mut resting_order: RestingOrder = RestingOrder::new(
            0,
            BaseAtoms::ZERO,
            QuoteAtomsPerBaseAtom::ZERO,
            0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            true,
            OrderType::Limit,
        )
        .unwrap();
        resting_order.set_last_valid_slot(1);
        resting_order.set_sequence_number(1);
    }
}
