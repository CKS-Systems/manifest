use std::mem::size_of;

use bytemuck::{Pod, Zeroable};
use hypertree::PodBool;
use shank::ShankAccount;
use solana_program::{program_error::ProgramError, pubkey::Pubkey};

use crate::{
    quantities::{BaseAtoms, GlobalAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom},
    state::OrderType,
};

/// Serialize and log an event
///
/// Note that this is done instead of a self-CPI, which would be more reliable
/// as explained here
/// <https://github.com/coral-xyz/anchor/blob/59ee310cfa18524e7449db73604db21b0e04780c/lang/attribute/event/src/lib.rs#L104>
/// because the goal of this program is to minimize the number of input
/// accounts, so including the signer for the self CPI is not worth it.
/// Also, be compatible with anchor parsing clients.
#[inline(never)] // ensure fresh stack frame
pub fn emit_stack<T: bytemuck::Pod + Discriminant>(e: T) -> Result<(), ProgramError> {
    // stack buffer, stack frames are 4kb
    let mut buffer: [u8; 3000] = [0u8; 3000];
    buffer[..8].copy_from_slice(&T::discriminant());
    *bytemuck::from_bytes_mut::<T>(&mut buffer[8..8 + size_of::<T>()]) = e;

    solana_program::log::sol_log_data(&[&buffer[..(size_of::<T>() + 8)]]);
    Ok(())
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct CreateMarketLog {
    pub market: Pubkey,
    pub creator: Pubkey,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct ClaimSeatLog {
    pub market: Pubkey,
    pub trader: Pubkey,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct DepositLog {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub mint: Pubkey,
    pub amount_atoms: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct WithdrawLog {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub mint: Pubkey,
    pub amount_atoms: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct FillLog {
    pub market: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub price: QuoteAtomsPerBaseAtom,
    pub base_atoms: BaseAtoms,
    pub quote_atoms: QuoteAtoms,
    pub maker_sequence_number: u64,
    pub taker_sequence_number: u64,
    pub taker_is_buy: PodBool,
    pub is_maker_global: PodBool,
    pub _padding: [u8; 14],
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct PlaceOrderLog {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub price: QuoteAtomsPerBaseAtom,
    pub base_atoms: BaseAtoms,
    pub order_sequence_number: u64,
    pub order_index: u32,
    pub last_valid_slot: u32,
    pub order_type: OrderType,
    pub is_bid: PodBool,
    pub _padding: [u8; 6],
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct CancelOrderLog {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub order_sequence_number: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct GlobalCreateLog {
    pub global: Pubkey,
    pub creator: Pubkey,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct GlobalAddTraderLog {
    pub global: Pubkey,
    pub trader: Pubkey,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct GlobalClaimSeatLog {
    pub global: Pubkey,
    pub market: Pubkey,
    pub trader: Pubkey,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct GlobalDepositLog {
    pub global: Pubkey,
    pub trader: Pubkey,
    pub global_atoms: GlobalAtoms,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct GlobalWithdrawLog {
    pub global: Pubkey,
    pub trader: Pubkey,
    pub global_atoms: GlobalAtoms,
}

#[repr(C)]
#[derive(Clone, Copy, Zeroable, Pod, ShankAccount)]
pub struct GlobalEvictLog {
    pub evictor: Pubkey,
    pub evictee: Pubkey,
    pub evictor_atoms: GlobalAtoms,
    pub evictee_atoms: GlobalAtoms,
}

pub trait Discriminant {
    fn discriminant() -> [u8; 8];
}

macro_rules! discriminant {
    ($type_name:ident, $value:ident, $test_name:ident) => {
        impl Discriminant for $type_name {
            fn discriminant() -> [u8; 8] {
                $value
            }
        }

        #[test]
        fn $test_name() {
            let mut buffer: [u8; 8] = [0u8; 8];
            let discriminant: u64 = crate::utils::get_discriminant::<$type_name>().unwrap();
            buffer[..8].copy_from_slice(&u64::to_le_bytes(discriminant));
            assert_eq!(buffer, $type_name::discriminant());
        }
    };
}

const CREATE_MARKET_LOG_DISCRIMINANT: [u8; 8] = [33, 31, 11, 6, 133, 143, 39, 71];
const CLAIM_SEAT_LOG_DISCRIMINANT: [u8; 8] = [129, 77, 152, 210, 218, 144, 163, 56];
const DEPOSIT_LOG_DISCRIMINANT: [u8; 8] = [23, 214, 24, 34, 52, 104, 109, 188];
const WITHDRAW_LOG_DISCRIMINANT: [u8; 8] = [112, 218, 111, 63, 18, 95, 136, 35];
const FILL_LOG_DISCRIMINANT: [u8; 8] = [58, 230, 242, 3, 75, 113, 4, 169];
const PLACE_ORDER_LOG_DISCRIMINANT: [u8; 8] = [157, 118, 247, 213, 47, 19, 164, 120];
const CANCEL_ORDER_LOG_DISCRIMINANT: [u8; 8] = [22, 65, 71, 33, 244, 235, 255, 215];
const GLOBAL_CREATE_LOG_DISCRIMINANT: [u8; 8] = [188, 25, 199, 77, 26, 15, 142, 193];
const GLOBAL_ADD_TRADER_LOG_DISCRIMINANT: [u8; 8] = [129, 246, 90, 94, 87, 186, 242, 7];
const GLOBAL_CLAIM_SEAT_LOG_DISCRIMINANT: [u8; 8] = [164, 46, 227, 175, 3, 143, 73, 86];
const GLOBAL_DEPOSIT_LOG_DISCRIMINANT: [u8; 8] = [16, 26, 72, 1, 145, 232, 182, 71];
const GLOBAL_WITHDRAW_LOG_DISCRIMINANT: [u8; 8] = [206, 118, 67, 64, 124, 109, 157, 201];
const GLOBAL_EVICT_LOG_DISCRIMINANT: [u8; 8] = [250, 180, 155, 38, 98, 223, 82, 223];

discriminant!(
    CreateMarketLog,
    CREATE_MARKET_LOG_DISCRIMINANT,
    test_create_market_log
);
discriminant!(
    ClaimSeatLog,
    CLAIM_SEAT_LOG_DISCRIMINANT,
    test_claim_seat_log
);
discriminant!(DepositLog, DEPOSIT_LOG_DISCRIMINANT, test_deposit_log);
discriminant!(WithdrawLog, WITHDRAW_LOG_DISCRIMINANT, test_withdraw_log);
discriminant!(FillLog, FILL_LOG_DISCRIMINANT, test_fill_log);
discriminant!(
    PlaceOrderLog,
    PLACE_ORDER_LOG_DISCRIMINANT,
    test_place_order
);
discriminant!(
    CancelOrderLog,
    CANCEL_ORDER_LOG_DISCRIMINANT,
    test_cancel_order
);
discriminant!(
    GlobalCreateLog,
    GLOBAL_CREATE_LOG_DISCRIMINANT,
    test_global_create_log
);
discriminant!(
    GlobalAddTraderLog,
    GLOBAL_ADD_TRADER_LOG_DISCRIMINANT,
    test_global_add_trader_log
);
discriminant!(
    GlobalClaimSeatLog,
    GLOBAL_CLAIM_SEAT_LOG_DISCRIMINANT,
    test_global_claim_seat_log
);
discriminant!(
    GlobalDepositLog,
    GLOBAL_DEPOSIT_LOG_DISCRIMINANT,
    test_global_deposit_log
);
discriminant!(
    GlobalWithdrawLog,
    GLOBAL_WITHDRAW_LOG_DISCRIMINANT,
    test_global_withdraw_log
);
discriminant!(
    GlobalEvictLog,
    GLOBAL_EVICT_LOG_DISCRIMINANT,
    test_global_evict_log
);
