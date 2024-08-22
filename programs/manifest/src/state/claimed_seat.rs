use std::mem::size_of;

use crate::quantities::{BaseAtoms, QuoteAtoms};
use bytemuck::{Pod, Zeroable};
use solana_program::pubkey::Pubkey;
use static_assertions::const_assert_eq;
use std::cmp::Ordering;

use super::constants::CLAIMED_SEAT_SIZE;

#[repr(C)]
#[derive(Default, Debug, Copy, Clone, Zeroable, Pod)]
pub struct ClaimedSeat {
    pub trader: Pubkey,
    // Balances are withdrawable on the exchange. They do not include funds in open orders.
    // When moving funds over to open orders, use the worst case rounding.
    pub base_withdrawable_balance: BaseAtoms,
    pub quote_withdrawable_balance: QuoteAtoms,
    _padding: [u8; 16],
}
// 32 + // trader
//  8 + // base_balance
//  8 + // quote_balance
// 16   // padding
// = 64
const_assert_eq!(size_of::<ClaimedSeat>(), CLAIMED_SEAT_SIZE);
const_assert_eq!(size_of::<ClaimedSeat>() % 8, 0);

impl ClaimedSeat {
    pub fn new_empty(trader: Pubkey) -> Self {
        ClaimedSeat {
            trader,
            base_withdrawable_balance: BaseAtoms::default(),
            quote_withdrawable_balance: QuoteAtoms::default(),
            _padding: [0; 16],
        }
    }
}

impl Ord for ClaimedSeat {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.trader).cmp(&(other.trader))
    }
}

impl PartialOrd for ClaimedSeat {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for ClaimedSeat {
    fn eq(&self, other: &Self) -> bool {
        (self.trader) == (other.trader)
    }
}

impl Eq for ClaimedSeat {}

impl std::fmt::Display for ClaimedSeat {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.trader)
    }
}

#[test]
fn test_display() {
    let claimed_seat: ClaimedSeat = ClaimedSeat::new_empty(Pubkey::default());
    format!("{}", claimed_seat);
}
