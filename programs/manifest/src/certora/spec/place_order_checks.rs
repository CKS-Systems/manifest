#![allow(unused_imports)]
use {
    crate::*,
    calltrace::*,
    cvt::{cvt_assert, cvt_assume, cvt_vacuity_check},
    cvt_macros::rule,
    nondet::*,
};

use {crate::*, solana_program::account_info::AccountInfo};

use program::withdraw;
use solana_cvt::token::spl_token_account_get_amount;
use state::{
    is_ask_order_free, is_bid_order_free, cvt_assume_second_trader_has_seat,
    get_helper_bid_order, get_helper_order, get_helper_seat, main_trader_index,
    order_type_can_rest, second_trader_index,
};

use crate::certora::spec::no_funds_loss_util::{*};
use crate::certora::spec::verification_utils::*;
use crate::program::{get_dynamic_account, get_mut_dynamic_account};
use crate::quantities::{BaseAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64};
use crate::state::claimed_seat::ClaimedSeat;
use crate::state::market::market_helpers::{
    AddOrderStatus, AddOrderToMarketInnerResult, AddSingleOrderCtx,
};
use crate::state::{AddOrderToMarketArgs, AddOrderToMarketResult, MarketFixed};
use crate::state::{DerefOrBorrowMut, DynamicAccount, MarketRef, MarketRefMut, RestingOrder};
use crate::validation::loaders::GlobalTradeAccounts;
use hypertree::{get_helper, get_mut_helper, DataIndex, RBNode};
use state::main_trader_pk;

pub fn place_single_order_nondet_inputs<const IS_BID:bool>(
    market_info: &AccountInfo
) -> (AddOrderToMarketArgs<'static, 'static>, BaseAtoms, u32) {
    let args: AddOrderToMarketArgs = AddOrderToMarketArgs {
        market: *market_info.key,
        trader_index: main_trader_index(),
        num_base_atoms: nondet(),
        price: QuoteAtomsPerBaseAtom::nondet_price_u32(),
        is_bid: IS_BID,
        last_valid_slot: nondet(),
        order_type: state::OrderType::Limit,
        global_trade_accounts_opts: &[None, None],
        current_slot: Some(nondet()),
    };
    let remaining_base_atoms: BaseAtoms = nondet();
    let now_slot: u32 = nondet();
    (args, remaining_base_atoms, now_slot)
}

pub fn place_single_order_canceled_check<const IS_BID: bool>() {
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

    let balances_old = record_all_balances(
        market_info,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
        maker_order_index,
    );

    // -- assume no loss of funds invariant
    cvt_assume_funds_invariants(balances_old);

    let (args, remaining_base_atoms, now_slot) =
        place_single_order_nondet_inputs::<IS_BID>(market_info);

    // -- call to place_single_order
    let (res, _total_base_atoms_traded, _total_quote_atoms_traded) = place_single_order!(
        market_info,
        args,
        remaining_base_atoms,
        now_slot,
        maker_order_index
    );
    cvt_assume!(res.status == AddOrderStatus::Canceled);

    let balances_new = record_all_balances(
        market_info,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
        maker_order_index,
    );

    // -- assert no loss of funds invariant
    cvt_assert_funds_invariants(balances_new);

    // -- additional assertions
    cvt_assert_place_single_order_canceled_extra::<IS_BID>(balances_old, balances_new);

    cvt_vacuity_check!();
}

#[rule]
pub fn rule_place_single_order_canceled_bid() {
    place_single_order_canceled_check::<true /* IS_BID */>();
}

#[rule]
pub fn rule_place_single_order_canceled_ask() {
    place_single_order_canceled_check::<false /* IS_BID */>();
}

pub fn place_single_order_unmatched_check<const IS_BID: bool>() {
    cvt_static_initializer!();

    let acc_infos: [AccountInfo; 16] = acc_infos_with_mem_layout!();
    let trader = &acc_infos[0];
    let market_info = &acc_infos[1];

    let maker_trader = &acc_infos[7];
    let vault_base_token = &acc_infos[8];
    let vault_quote_token = &acc_infos[9];

    let maker_order_index: DataIndex = cvt_assume_market_preconditions::<IS_BID>(
        market_info,
        trader,
        vault_base_token,
        vault_quote_token,
        maker_trader,
    );

    // -- record balances 

    let balances_old = record_all_balances(
        market_info,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
        maker_order_index,
    );

    // -- assume no loss of funds invariant
    cvt_assume_funds_invariants(balances_old);

    let (args, remaining_base_atoms, now_slot) =
        place_single_order_nondet_inputs::<IS_BID>(market_info);

    // -- call to place_single_order
    let (res, _total_base_atoms_traded, _total_quote_atoms_traded) = place_single_order!(
        market_info,
        args,
        remaining_base_atoms,
        now_slot,
        maker_order_index
    );
    cvt_assume!(res.status == AddOrderStatus::Unmatched);

    let balances_new = record_all_balances(
        market_info,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
        maker_order_index,
    );

    // -- assert no loss of funds invariant
    cvt_assert_funds_invariants(balances_new);

    // -- additional assertions
    cvt_assert_place_single_order_canceled_extra::<IS_BID>(balances_old, balances_new);

    cvt_vacuity_check!();
}

#[rule]
pub fn rule_place_single_order_unmatched_bid() {
    place_single_order_unmatched_check::<true /* IS_BID */>();
}

#[rule]
pub fn rule_place_single_order_unmatched_ask() {
    place_single_order_unmatched_check::<false /* IS_BID */>();
}

pub fn place_single_order_full_match_check<const IS_BID: bool>() {
    cvt_static_initializer!();

    let acc_infos: [AccountInfo; 16] = acc_infos_with_mem_layout!();
    let trader = &acc_infos[0];
    let market_info = &acc_infos[1];

    let maker_trader = &acc_infos[7];
    let vault_base_token = &acc_infos[8];
    let vault_quote_token = &acc_infos[9];

    // -- market assumptions

    let maker_order_index: DataIndex = cvt_assume_market_preconditions::<IS_BID>(
        market_info,
        trader,
        vault_base_token,
        vault_quote_token,
        maker_trader,
    );

    // -- record balances before place_single_order

    let balances_old = record_all_balances(
        market_info,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
        maker_order_index,
    );

    // -- assume no loss of funds invariant
    cvt_assume_funds_invariants(balances_old);

    let (args, remaining_base_atoms, now_slot) =
        place_single_order_nondet_inputs::<IS_BID>(market_info);

    // -- call to place_single_order
    let (res, total_base_atoms_traded, total_quote_atoms_traded) = place_single_order!(
        market_info,
        args,
        remaining_base_atoms,
        now_slot,
        maker_order_index
    );
    cvt_assume!(res.status == AddOrderStatus::Filled);

    let balances_new = record_all_balances(
        market_info,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
        maker_order_index,
    );

    // -- assert no loss of funds invariant
    cvt_assert_funds_invariants(balances_new);

    // -- additional asserts
    cvt_assert_place_single_order_full_match_extra::<IS_BID>(
        balances_old, 
        balances_new, 
        total_base_atoms_traded, 
        total_quote_atoms_traded
    );

    cvt_vacuity_check!();
}

#[rule]
pub fn rule_place_single_order_full_match_bid() {
    place_single_order_full_match_check::<true /* IS_BID */>();
}

#[rule]
pub fn rule_place_single_order_full_match_ask() {
    place_single_order_full_match_check::<false /* IS_BID */>();
}

pub fn place_single_order_partial_match_check<const IS_BID: bool>() {
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

    // -- record balances before place_single_order
    let balances_old = record_all_balances(
        market_info,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
        maker_order_index,
    );

    // -- assume no loss of funds invariant
    cvt_assume_funds_invariants(balances_old);

    let (args, remaining_base_atoms, now_slot) =
        place_single_order_nondet_inputs::<IS_BID>(market_info);

    // -- call to place_single_order
    let (res, total_base_atoms_traded, total_quote_atoms_traded) = place_single_order!(
        market_info,
        args,
        remaining_base_atoms,
        now_slot,
        maker_order_index
    );
    cvt_assume!(res.status == AddOrderStatus::PartialFill);

    let balances_new = record_all_balances(
        market_info,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
        maker_order_index,
    );

    // -- assert no loss of funds invariant
    cvt_assert_funds_invariants(balances_new);

    // -- additional asserts
    cvt_assert_place_single_order_partial_match_extra::<IS_BID>(
        balances_old, 
        balances_new, 
        total_base_atoms_traded, 
        total_quote_atoms_traded
    );

    cvt_vacuity_check!();
}

#[rule]
pub fn rule_place_single_order_partial_match_bid() {
    place_single_order_partial_match_check::<true /* IS_BID */>();
}

#[rule]
pub fn rule_place_single_order_partial_match_ask() {
    place_single_order_partial_match_check::<false /* IS_BID */>();
}