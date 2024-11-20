#![allow(unused_imports)]
use crate::*;
use calltrace::*;
use cvt::{cvt_assert, cvt_assume, cvt_vacuity_check};
use cvt_macros::rule;
use nondet::*;

use hypertree::DataIndex;
use solana_program::account_info::AccountInfo;
use state::claimed_seat::ClaimedSeat;

use crate::{
    program::get_mut_dynamic_account,
    quantities::{BaseAtoms, QuoteAtoms, WrapperU64},
    state::{get_helper_order, DynamicAccount, MarketRefMut, RestingOrder},
};
use solana_cvt::token::spl_token_account_get_amount;

use state::{
    dynamic_account, get_helper_seat, is_ask_order_free, is_ask_order_taken, is_bid_order_free,
    is_bid_order_taken, main_ask_order_index, main_bid_order_index, main_trader_index,
};

use crate::certora::spec::no_funds_loss_util::cvt_assume_market_preconditions;

/// Assumes that either the bid or ask main order is present.
fn assume_main_order_is_present<const IS_BID: bool>() {
    if IS_BID {
        cvt_assume!(is_bid_order_taken());
    } else {
        cvt_assume!(is_ask_order_taken());
    }
}

/// Checks that `cancel_order_by_index` cancels the order only if the trader who
/// is cancelling the order is the one who originally placed the order.
/// The rule does not verify because `cancel_order_by_index` does not check this.
pub fn cancel_order_by_index_trader_integrity_check<const IS_BID: bool>() {
    cvt_static_initializer!();

    let acc_infos: [AccountInfo; 16] = acc_infos_with_mem_layout!();
    let market_info = &acc_infos[0];

    // Market preconditions
    assume_main_order_is_present::<IS_BID>();

    // Index of the order that has to be cancelled.
    let order_index = if IS_BID {
        main_bid_order_index()
    } else {
        main_ask_order_index()
    };

    // Needed as an argument to get_helper_order, but is not used
    let dynamic = &mut [0; 8];
    let order_to_cancel: &RestingOrder = get_helper_order(dynamic, order_index).get_value();

    // Make sure the order is consistent with IS_BID
    cvt_assume!(order_to_cancel.get_is_bid() == IS_BID);

    // Global orders are currently not in the scope of this rule.
    cvt_assume!(order_to_cancel.is_global() == false);

    // Nondeterministic trader who cancels the order.
    let trader_who_cancels: DataIndex = nondet();

    // Get the trader who placed the order.
    let trader_who_placed_order = order_to_cancel.get_trader_index();

    // Call cancel_order_by_index
    cancel_order_by_index!(market_info, trader_who_cancels, order_index);

    // If the cancel order terminates correctly, then the trader who
    // originally placed the order has to be the trader who issued the
    // cancellation.
    cvt_assert!(trader_who_placed_order == trader_who_cancels);

    cvt_vacuity_check!();
}

#[rule]
fn rule_cancel_order_trader_integrity_bid() {
    cancel_order_by_index_trader_integrity_check::<true /* IS_BID */>();
}

#[rule]
fn rule_cancel_order_trader_integrity_ask() {
    cancel_order_by_index_trader_integrity_check::<false /* IS_BID */>();
}

pub fn cancel_order_by_index_no_revert<const IS_BID: bool>() {
    // IS_BID = true sets up the rule such that the order to
    // be canceled is ask, and vice-versa

    cvt_static_initializer!();

    let acc_infos: [AccountInfo; 16] = acc_infos_with_mem_layout!();
    let trader = &acc_infos[0];
    let market_info = &acc_infos[1];
    let maker_trader = &acc_infos[7];
    let vault_base_token = &acc_infos[8];
    let vault_quote_token = &acc_infos[9];

    // -- market preconditions
    let maker_order_index: DataIndex = cvt_assume_market_preconditions::<IS_BID>(
        market_info,
        trader,
        vault_base_token,
        vault_quote_token,
        maker_trader,
    );

    // Assume that there will not be an overflow when adding to seat balance.
    let (maker_order_base, maker_order_quote) = get_order_atoms!(maker_order_index);
    let (maker_seat_base, maker_seat_quote) = get_trader_balance!(market_info, maker_trader.key);
    if IS_BID {
        cvt_assume!(maker_seat_base + maker_order_base.as_u64() <= u64::MAX);
    } else {
        cvt_assume!(maker_seat_quote + maker_order_quote.as_u64() <= u64::MAX);
    }

    // -- call to cancel_order_by_index
    let market_data = &mut market_info.try_borrow_mut_data().unwrap();
    let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
    let trader_index = crate::state::second_trader_index();
    let order_index = maker_order_index;
    let result = dynamic_account.cancel_order_by_index(trader_index, order_index, &[None, None]);
    cvt_assert!(result.is_ok());

    cvt_vacuity_check!();
}

#[rule]
pub fn rule_cancel_order_by_index_no_revert_bid() {
    cancel_order_by_index_no_revert::<true>();
}

#[rule]
pub fn rule_cancel_order_by_index_no_revert_ask() {
    cancel_order_by_index_no_revert::<false>();
}
