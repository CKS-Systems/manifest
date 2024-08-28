#![allow(unused_macros)]
#![allow(unused_imports)]

use {
    solana_program::{account_info::AccountInfo,
                     pubkey::Pubkey,
    },
};

use crate::program::get_dynamic_account;

// HERE nondet functions for manifest specific types to be used in
// rules

// HERE helper functions to deserialize data to be used in rules

#[macro_export]
macro_rules! create_empty_market {
    ($market_acc_info:expr) => {{
      let empty_market_fixed: MarketFixed = MarketFixed::new_nondet();
      //cvt_cex_print_tag!(1);
      let mut market_bytes = $market_acc_info.data.try_borrow_mut().unwrap();
      //cvt_cex_print_tag!(2);
      *get_mut_helper::<MarketFixed>(*market_bytes, 0_u32) = empty_market_fixed;
    }};
}

#[macro_export]
macro_rules! claim_seat {
    ($market_acc_info:expr, $trader_key: expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let mut dynamic_account = get_mut_dynamic_account(market_data);
        dynamic_account.claim_seat($trader_key).unwrap();
    }};
}

#[macro_export]
macro_rules! get_trader_index {
    ($market_acc_info:expr, $trader_key: expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let mut dynamic_account = get_mut_dynamic_account(market_data);
        dynamic_account.get_trader_index($trader_key)
    }};
}

#[macro_export]
/// Return a pair of (base_atoms, quote_atoms) as u64
macro_rules! get_trader_balance {
    ($market_acc_info:expr, $trader_key: expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        let (base_atoms, quote_atoms) = dynamic_account.get_trader_balance($trader_key);
        (u64::from(base_atoms), u64::from(quote_atoms))
    }};
}

#[macro_export]
macro_rules! update_balance {
    ($market_acc_info:expr, $trader_index: expr, $is_base: expr, $is_increase: expr, $amount: expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        let DynamicAccount { fixed, dynamic } = dynamic_account;
        crate::state::update_balance(fixed, dynamic, $trader_index, $is_base, $is_increase, $amount).unwrap();
    }};
}

#[macro_export]
macro_rules! cvt_assert_is_nil {
    ($e:expr) => {
        cvt_assert!(is_nil!($e))
    };
}

#[macro_export]
macro_rules! deposit {
    ($market_acc_info:expr, $trader_key: expr, $in_atoms: expr, $is_base_in: expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let mut dynamic_account = get_mut_dynamic_account(market_data);
        dynamic_account.deposit($trader_key, $in_atoms, $is_base_in).unwrap();
    }};
}

#[macro_export]
/// Return the base token vault
macro_rules! get_base_vault {
    ($market_acc_info:expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        let DynamicAccount { fixed, .. } = dynamic_account;
        *fixed.get_base_vault()
    }};
}
#[macro_export]

/// Return the quote token vault
macro_rules! get_quote_vault {
    ($market_acc_info:expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        let DynamicAccount { fixed, .. } = dynamic_account;
        *fixed.get_quote_vault()
    }};
}

#[macro_export]
/// Return the withdrawable base token amount
macro_rules! get_withdrawable_base_atoms {
    ($market_acc_info:expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        let DynamicAccount { fixed, .. } = dynamic_account;
        fixed.get_withdrawable_base_atoms().as_u64()
    }};
}
#[macro_export]
/// Return the withdrawable quote token amount
macro_rules! get_withdrawable_quote_atoms {
    ($market_acc_info:expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        let DynamicAccount { fixed, .. } = dynamic_account;
        fixed.get_withdrawable_quote_atoms().as_u64()
    }};
}
#[macro_export]
/// Return the orderbook base token amount
macro_rules! get_orderbook_base_atoms {
    ($market_acc_info:expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        let DynamicAccount { fixed, .. } = dynamic_account;
        fixed.get_orderbook_base_atoms().as_u64()
    }};
}
#[macro_export]
/// Return the orderbook quote token amount
macro_rules! get_orderbook_quote_atoms {
    ($market_acc_info:expr) => {{
        let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
        let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        let DynamicAccount { fixed, .. } = dynamic_account;
        fixed.get_orderbook_quote_atoms().as_u64()
    }};
}

#[macro_export]
macro_rules! get_order_atoms {
    ($index:expr) => {{
        let dynamic = [0u8; 8];
        let order = get_helper_order(&dynamic, $index).get_value();
        order.get_orderbook_atoms().unwrap()
    }};
}

#[macro_export]
macro_rules! rest_remaining {
    ($market_acc_info:expr, 
    $args:expr, 
    $remaining_base_atoms: expr, 
    $order_sequence_number: expr, 
    $total_base_atoms_traded: expr,
    $total_quote_atoms_traded: expr) => 
        {{
            let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
            let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
            // let DynamicAccount { fixed, .. } = dynamic_account;
            dynamic_account.rest_remaining(
                $args, 
                $remaining_base_atoms, 
                $order_sequence_number, 
                $total_base_atoms_traded, 
                $total_quote_atoms_traded
            ).unwrap()
        }};
}

#[macro_export]
macro_rules! cancel_order_by_index {
    (
        $market_acc_info:expr, 
        $trader_index:expr, 
        $order_index:expr
    ) => 
        {{
            let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
            let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
            dynamic_account.cancel_order_by_index(
                $trader_index,
                $order_index,
                &[None, None]
            ).unwrap();
        }};
}


#[macro_export]
macro_rules! place_single_order {
    (
        $market_acc_info:expr, 
        $args:expr, 
        $remaining_base_atoms: expr, 
        $now_slot: expr,
        $current_order_index: expr
    ) => 
        {{
            let market_data = &mut $market_acc_info.try_borrow_mut_data().unwrap();
            let dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
            let DynamicAccount { fixed, dynamic } = dynamic_account;
            
            let mut ctx: AddSingleOrderCtx = AddSingleOrderCtx::new(
                $args,
                fixed,
                dynamic,
                $remaining_base_atoms,
                $now_slot
            );
            
            let res: AddOrderToMarketInnerResult = ctx.place_single_order(
                $current_order_index
            ).unwrap();
            (res, ctx.total_base_atoms_traded, ctx.total_quote_atoms_traded)
        }};
}


extern "C" {
    fn memhavoc_c(data: *mut u8, sz: usize) -> ();
}
pub fn memhavoc(data: *mut u8, size: usize) {
    unsafe {
        memhavoc_c(data, size);
    }
}

pub fn alloc_havoced<T: Sized> () -> *mut T {
    use std::alloc::{Layout, alloc};
    let layout = Layout::new::<T>();
    unsafe {
        let ptr = std::alloc::alloc(layout);
        memhavoc(ptr, layout.size());
        ptr as *mut T
    }
}

