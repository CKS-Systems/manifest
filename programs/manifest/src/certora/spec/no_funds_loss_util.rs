use cvt::{cvt_assert, cvt_assume};
use nondet::*;

use crate::*;
use solana_program::account_info::AccountInfo;
use state::{
    is_ask_order_taken, is_bid_order_taken, main_ask_order_index, main_bid_order_index, OrderType,
};
use crate::{
    program::get_mut_dynamic_account,
    quantities::{BaseAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{
        cvt_assume_second_trader_has_seat, get_helper_order,
        is_ask_order_free, is_bid_order_free,
        second_trader_index, DynamicAccount, MarketRefMut,
        RestingOrder,
    },
};
use hypertree::DataIndex;
use solana_cvt::token::spl_token_account_get_amount;

#[derive(Clone, Copy)]
pub struct AllBalances {
    pub vault_base: u64,
    pub vault_quote: u64,
    pub withdrawable_base: u64,
    pub orderbook_base: u64,
    pub withdrawable_quote: u64,
    pub orderbook_quote: u64,
    pub trader_base: u64,
    pub trader_quote: u64,
    pub maker_trader_base: u64,
    pub maker_trader_quote: u64,
    pub maker_order_base: u64,
    pub maker_order_quote: u64,
}

impl AllBalances {
    pub fn new(
        vault_base: u64,
        vault_quote: u64,
        withdrawable_base: u64,
        orderbook_base: u64,
        withdrawable_quote: u64,
        orderbook_quote: u64,
        trader_base: u64,
        trader_quote: u64,
        maker_trader_base: u64,
        maker_trader_quote: u64,
        maker_order_base: u64,
        maker_order_quote: u64,
    ) -> Self {
        Self {
            vault_base,
            vault_quote,
            withdrawable_base,
            orderbook_base,
            withdrawable_quote,
            orderbook_quote,
            trader_base,
            trader_quote,
            maker_trader_base,
            maker_trader_quote,
            maker_order_base,
            maker_order_quote,
        }
    }
}

/// Extract all relevant balances from all accounts
pub fn record_all_balances_without_order(
    market: &AccountInfo,
    vault_base_token: &AccountInfo,
    vault_quote_token: &AccountInfo,
    trader: &AccountInfo,
    maker_trader: &AccountInfo,
) -> AllBalances {
    let (trader_base, trader_quote) = get_trader_balance!(market, trader.key);
    let (maker_trader_base, maker_trader_quote) = get_trader_balance!(market, maker_trader.key);

    let withdrawable_base: u64 = get_withdrawable_base_atoms!(market);
    let withdrawable_quote: u64 = get_withdrawable_quote_atoms!(market);

    let orderbook_base: u64 = get_orderbook_base_atoms!(market);
    let orderbook_quote: u64 = get_orderbook_quote_atoms!(market);

    let vault_base: u64 = spl_token_account_get_amount(vault_base_token);
    let vault_quote: u64 = spl_token_account_get_amount(vault_quote_token);

    AllBalances::new(
        vault_base,
        vault_quote,
        withdrawable_base,
        orderbook_base,
        withdrawable_quote,
        orderbook_quote,
        trader_base,
        trader_quote,
        maker_trader_base,
        maker_trader_quote,
        0,
        0,
    )
}

/// Extract all relevant balances from all accounts and a maker order
pub fn record_all_balances(
    market: &AccountInfo,
    vault_base_token: &AccountInfo,
    vault_quote_token: &AccountInfo,
    trader: &AccountInfo,
    maker_trader: &AccountInfo,
    maker_order_index: DataIndex,
) -> AllBalances {
    let mut all_balances = record_all_balances_without_order(
        market,
        vault_base_token,
        vault_quote_token,
        trader,
        maker_trader,
    );
    let (maker_order_base, maker_order_quote) = get_order_atoms!(maker_order_index);
    all_balances.maker_order_base = maker_order_base.as_u64();
    all_balances.maker_order_quote = maker_order_quote.as_u64();
    all_balances
}

// Very basic market pre-conditions
pub fn cvt_assume_basic_market_preconditions(
    market: &AccountInfo,
    trader: &AccountInfo,
    vault_base_token: &AccountInfo,
    vault_quote_token: &AccountInfo,
    maker_trader: &AccountInfo,
) {
    // -- assume both maker and taker traders have seats
    state::cvt_assume_main_trader_has_seat(trader.key);
    cvt_assume_second_trader_has_seat(maker_trader.key);

    // -- assume market has proper base and quote vaults
    let market_base_vault_pk: Pubkey = get_base_vault!(market);
    let market_quote_vault_pk: Pubkey = get_quote_vault!(market);
    cvt_assume!(vault_base_token.key == &market_base_vault_pk);
    cvt_assume!(vault_quote_token.key == &market_quote_vault_pk);
    // -- assume base and quote vaults are different
    cvt_assume!(market_base_vault_pk != market_quote_vault_pk);

    // -- maker and taker traders are distinct
    cvt_assume!(trader.key != maker_trader.key);
}

/// Basic market pre-conditions
pub fn cvt_assume_market_preconditions<const IS_BID: bool>(
    market: &AccountInfo,
    trader: &AccountInfo,
    vault_base_token: &AccountInfo,
    vault_quote_token: &AccountInfo,
    maker_trader: &AccountInfo,
) -> DataIndex {
    // -- assume both maker and taker traders have seats
    crate::state::cvt_assume_main_trader_has_seat(trader.key);
    crate::state::cvt_assume_second_trader_has_seat(maker_trader.key);

    // -- assume market has proper base and quote vaults
    let market_base_vault_pk: Pubkey = get_base_vault!(market);
    let market_quote_vault_pk: Pubkey = get_quote_vault!(market);
    cvt_assume!(vault_base_token.key == &market_base_vault_pk);
    cvt_assume!(vault_quote_token.key == &market_quote_vault_pk);
    // -- assume base and quote vaults are different
    cvt_assume!(market_base_vault_pk != market_quote_vault_pk);

    // -- maker and taker traders are distinct
    cvt_assume!(trader.key != maker_trader.key);

    let maker_trader_index: DataIndex = second_trader_index();

    // we assume that the slot into which our new order could rest is free,
    // while the slot in the other book that we want to try and match with is filled
    if IS_BID {
        cvt_assume!(is_bid_order_free());
        cvt_assume!(is_ask_order_taken());
    } else {
        cvt_assume!(is_ask_order_free());
        cvt_assume!(is_bid_order_taken());
    }

    // -- get index of the maker order, based on the book we expect it to be in
    let maker_order_index: DataIndex = if IS_BID {
        main_ask_order_index()
    } else {
        main_bid_order_index()
    };

    // -- assume maker order is sane and not global
    let dynamic: &mut [u8; 8] = &mut [0; 8];
    let maker_order: &RestingOrder = get_helper_order(dynamic, maker_order_index).get_value();
    cvt_assume!(maker_order.get_is_bid() == !IS_BID);
    cvt_assume!(maker_order.get_order_type() != OrderType::Global);
    cvt_assume!(maker_order.get_trader_index() == maker_trader_index);
    cvt_assume!(maker_order.get_num_base_atoms() == BaseAtoms::new(nondet()));
    cvt_assume!(maker_order.get_price() == QuoteAtomsPerBaseAtom::nondet_price_u32());

    maker_order_index
}

pub fn cvt_assume_funds_invariants(balances: AllBalances) {
    let AllBalances {
        vault_base,
        vault_quote,
        withdrawable_base,
        orderbook_base,
        withdrawable_quote,
        orderbook_quote,
        trader_base,
        trader_quote,
        maker_trader_base,
        maker_trader_quote,
        maker_order_base,
        maker_order_quote,
    } = balances;

    // -- the sum of the trader amounts is less than aggregates
    cvt_assume!(trader_base.checked_add(maker_trader_base).unwrap() <= withdrawable_base);
    cvt_assume!(trader_quote.checked_add(maker_trader_quote).unwrap() <= withdrawable_quote);

    // -- maker order amounts are less than aggregates
    cvt_assume!(maker_order_base <= orderbook_base);
    cvt_assume!(maker_order_quote <= orderbook_quote);

    // -- vaults have enough funds to cover all obligations
    cvt_assume!(vault_base == withdrawable_base.checked_add(orderbook_base).unwrap());
    cvt_assume!(vault_quote == withdrawable_quote.checked_add(orderbook_quote).unwrap());
}

pub fn cvt_assert_funds_invariants(balances: AllBalances) {
    let AllBalances {
        vault_base,
        vault_quote,
        withdrawable_base,
        orderbook_base,
        withdrawable_quote,
        orderbook_quote,
        trader_base,
        trader_quote,
        maker_trader_base,
        maker_trader_quote,
        maker_order_base: _,
        maker_order_quote: _,
    } = balances;

    // using non-checked arithmetic in the assertion to not hide any potentially bad executions

    // -- the sum of the trader amounts is less than aggregates
    cvt_assert!(trader_base.saturating_add(maker_trader_base) <= withdrawable_base);
    cvt_assert!(trader_quote.saturating_add(maker_trader_quote) <= withdrawable_quote);

    // -- vaults have enough funds to cover all obligations
    cvt_assert!(vault_base == withdrawable_base.saturating_add(orderbook_base));
    cvt_assert!(vault_quote == withdrawable_quote.saturating_add(orderbook_quote));
}

pub fn cvt_assert_place_single_order_canceled_extra<const IS_BID: bool>(
    balances_old: AllBalances,
    balances_new: AllBalances,
) {
    let AllBalances {
        vault_base: vault_base_old,
        vault_quote: vault_quote_old,
        withdrawable_base: withdrawable_base_old,
        orderbook_base: orderbook_base_old,
        withdrawable_quote: withdrawable_quote_old,
        orderbook_quote: orderbook_quote_old,
        trader_base: _trader_base_old,
        trader_quote: _trader_quote_old,
        maker_trader_base: _maker_trader_base_old,
        maker_trader_quote: _maker_trader_quote_old,
        maker_order_base: _maker_order_base_old,
        maker_order_quote: _maker_order_quote_old,
    } = balances_old;

    let AllBalances {
        vault_base: vault_base_new,
        vault_quote: vault_quote_new,
        withdrawable_base: withdrawable_base_new,
        orderbook_base: orderbook_base_new,
        withdrawable_quote: withdrawable_quote_new,
        orderbook_quote: orderbook_quote_new,
        trader_base: _trader_base_new,
        trader_quote: _trader_quote_new,
        maker_trader_base: _maker_trader_base_new,
        maker_trader_quote: _maker_trader_quote_new,
        maker_order_base: _maker_order_base_new,
        maker_order_quote: _maker_order_quote_new,
    } = balances_new;

    // -- additional asserts
    cvt_assert!(vault_base_old == vault_base_new);
    cvt_assert!(vault_quote_old == vault_quote_new);
    cvt_assert!(
        withdrawable_base_old.saturating_add(orderbook_base_old)
            == withdrawable_base_new.saturating_add(orderbook_base_new)
    );
    cvt_assert!(
        withdrawable_quote_old.saturating_add(orderbook_quote_old)
            == withdrawable_quote_new.saturating_add(orderbook_quote_new)
    );
}

pub fn cvt_assert_place_single_order_unmatched_extra<const IS_BID: bool>(
    balances_old: AllBalances,
    balances_new: AllBalances,
) {
    let AllBalances {
        vault_base: vault_base_old,
        vault_quote: vault_quote_old,
        withdrawable_base: withdrawable_base_old,
        orderbook_base: orderbook_base_old,
        withdrawable_quote: withdrawable_quote_old,
        orderbook_quote: orderbook_quote_old,
        trader_base: _trader_base_old,
        trader_quote: _trader_quote_old,
        maker_trader_base: _maker_trader_base_old,
        maker_trader_quote: _maker_trader_quote_old,
        maker_order_base: _maker_order_base_old,
        maker_order_quote: _maker_order_quote_old,
    } = balances_old;

    let AllBalances {
        vault_base: vault_base_new,
        vault_quote: vault_quote_new,
        withdrawable_base: withdrawable_base_new,
        orderbook_base: orderbook_base_new,
        withdrawable_quote: withdrawable_quote_new,
        orderbook_quote: orderbook_quote_new,
        trader_base: _trader_base_new,
        trader_quote: _trader_quote_new,
        maker_trader_base: _maker_trader_base_new,
        maker_trader_quote: _maker_trader_quote_new,
        maker_order_base: _maker_order_base_new,
        maker_order_quote: _maker_order_quote_new,
    } = balances_new;

    // -- additional asserts
    cvt_assert!(withdrawable_base_new == withdrawable_base_old);
    cvt_assert!(withdrawable_quote_new == withdrawable_quote_old);
    cvt_assert!(orderbook_base_new == orderbook_base_old);
    cvt_assert!(orderbook_quote_new == orderbook_quote_old);
    cvt_assert!(vault_base_old == vault_base_new);
    cvt_assert!(vault_quote_old == vault_quote_new);
    cvt_assert!(
        withdrawable_base_old.saturating_add(orderbook_base_old)
            == withdrawable_base_new.saturating_add(orderbook_base_new)
    );
    cvt_assert!(
        withdrawable_quote_old.saturating_add(orderbook_quote_old)
            == withdrawable_quote_new.saturating_add(orderbook_quote_new)
    );
}

pub fn cvt_assert_place_single_order_full_match_extra<const IS_BID: bool>(
    balances_old: AllBalances,
    balances_new: AllBalances,
    total_base_atoms_traded: BaseAtoms,
    total_quote_atoms_traded: QuoteAtoms,
) {
    let AllBalances {
        vault_base: vault_base_old,
        vault_quote: vault_quote_old,
        withdrawable_base: withdrawable_base_old,
        orderbook_base: orderbook_base_old,
        withdrawable_quote: withdrawable_quote_old,
        orderbook_quote: orderbook_quote_old,
        trader_base: _trader_base_old,
        trader_quote: _trader_quote_old,
        maker_trader_base: _maker_trader_base_old,
        maker_trader_quote: _maker_trader_quote_old,
        maker_order_base: _maker_order_base_old,
        maker_order_quote: _maker_order_quote_old,
    } = balances_old;

    let AllBalances {
        vault_base: vault_base_new,
        vault_quote: vault_quote_new,
        withdrawable_base: withdrawable_base_new,
        orderbook_base: orderbook_base_new,
        withdrawable_quote: withdrawable_quote_new,
        orderbook_quote: orderbook_quote_new,
        trader_base: _trader_base_new,
        trader_quote: _trader_quote_new,
        maker_trader_base: _maker_trader_base_new,
        maker_trader_quote: _maker_trader_quote_new,
        maker_order_base: _maker_order_base_new,
        maker_order_quote: _maker_order_quote_new,
    } = balances_new;

    if IS_BID {
        cvt_assert!(total_base_atoms_traded.as_u64() <= orderbook_base_old);
        cvt_assert!(orderbook_base_new <= orderbook_base_old);
        cvt_assert!(
            orderbook_base_old.saturating_sub(orderbook_base_new)
                == total_base_atoms_traded.as_u64()
        );
        cvt_assert!(withdrawable_base_new >= withdrawable_base_old);
        cvt_assert!(
            withdrawable_base_new.saturating_sub(withdrawable_base_old)
                == orderbook_base_old.saturating_sub(orderbook_base_new)
        );
        cvt_assert!(withdrawable_quote_old == withdrawable_quote_new);
        cvt_assert!(orderbook_quote_old == orderbook_quote_new);
    } else {
        cvt_assert!(total_quote_atoms_traded.as_u64() <= orderbook_quote_old);
        cvt_assert!(orderbook_quote_new <= orderbook_quote_old);
        cvt_assert!(
            orderbook_quote_old.saturating_sub(orderbook_quote_new)
                <= total_quote_atoms_traded.as_u64().saturating_add(1)
        );
        cvt_assert!(
            orderbook_quote_old.saturating_sub(orderbook_quote_new)
                >= total_quote_atoms_traded.as_u64()
        );
        cvt_assert!(withdrawable_quote_new >= withdrawable_quote_old);
        cvt_assert!(
            withdrawable_quote_new.saturating_sub(withdrawable_quote_old)
                == orderbook_quote_old.saturating_sub(orderbook_quote_new)
        );
        cvt_assert!(withdrawable_base_old == withdrawable_base_new);
        cvt_assert!(orderbook_base_old == orderbook_base_new);
    }
    cvt_assert!(vault_base_old == vault_base_new);
    cvt_assert!(vault_quote_old == vault_quote_new);
    cvt_assert!(
        withdrawable_base_old.saturating_add(orderbook_base_old)
            == withdrawable_base_new.saturating_add(orderbook_base_new)
    );
    cvt_assert!(
        withdrawable_quote_old.saturating_add(orderbook_quote_old)
            == withdrawable_quote_new.saturating_add(orderbook_quote_new)
    );
}

pub fn cvt_assert_place_single_order_partial_match_extra<const IS_BID: bool>(
    balances_old: AllBalances,
    balances_new: AllBalances,
    total_base_atoms_traded: BaseAtoms,
    total_quote_atoms_traded: QuoteAtoms,
) {
    let AllBalances {
        vault_base: vault_base_old,
        vault_quote: vault_quote_old,
        withdrawable_base: withdrawable_base_old,
        orderbook_base: orderbook_base_old,
        withdrawable_quote: withdrawable_quote_old,
        orderbook_quote: orderbook_quote_old,
        trader_base: _trader_base_old,
        trader_quote: _trader_quote_old,
        maker_trader_base: _maker_trader_base_old,
        maker_trader_quote: _maker_trader_quote_old,
        maker_order_base: _maker_order_base_old,
        maker_order_quote: _maker_order_quote_old,
    } = balances_old;

    let AllBalances {
        vault_base: vault_base_new,
        vault_quote: vault_quote_new,
        withdrawable_base: withdrawable_base_new,
        orderbook_base: orderbook_base_new,
        withdrawable_quote: withdrawable_quote_new,
        orderbook_quote: orderbook_quote_new,
        trader_base: _trader_base_new,
        trader_quote: _trader_quote_new,
        maker_trader_base: _maker_trader_base_new,
        maker_trader_quote: _maker_trader_quote_new,
        maker_order_base: _maker_order_base_new,
        maker_order_quote: _maker_order_quote_new,
    } = balances_new;

    if IS_BID {
        // -- additional assertions
        cvt_assert!(total_base_atoms_traded.as_u64() <= orderbook_base_old);
        cvt_assert!(orderbook_base_new <= orderbook_base_old);
        cvt_assert!(
            orderbook_base_old.saturating_sub(orderbook_base_new)
                == total_base_atoms_traded.as_u64()
        );
        cvt_assert!(withdrawable_base_new >= withdrawable_base_old);
        cvt_assert!(
            withdrawable_base_new.saturating_sub(withdrawable_base_old)
                == orderbook_base_old.saturating_sub(orderbook_base_new)
        );
        cvt_assert!(withdrawable_quote_old == withdrawable_quote_new);
        cvt_assert!(orderbook_quote_old == orderbook_quote_new);
    } else {
        // -- additional assertions
        cvt_assert!(total_quote_atoms_traded.as_u64() <= orderbook_quote_old);
        cvt_assert!(orderbook_quote_new <= orderbook_quote_old);
        cvt_assert!(
            orderbook_quote_old.saturating_sub(orderbook_quote_new)
                <= total_quote_atoms_traded.as_u64().saturating_add(1)
        );
        cvt_assert!(
            orderbook_quote_old.saturating_sub(orderbook_quote_new)
                >= total_quote_atoms_traded.as_u64()
        );
        cvt_assert!(withdrawable_quote_new >= withdrawable_quote_old);
        cvt_assert!(
            withdrawable_quote_new.saturating_sub(withdrawable_quote_old)
                == orderbook_quote_old.saturating_sub(orderbook_quote_new)
        );
        cvt_assert!(withdrawable_base_old == withdrawable_base_new);
        cvt_assert!(orderbook_base_old == orderbook_base_new);
    }
    cvt_assert!(vault_base_old == vault_base_new);
    cvt_assert!(vault_quote_old == vault_quote_new);
    cvt_assert!(
        withdrawable_base_old.saturating_add(orderbook_base_old)
            == withdrawable_base_new.saturating_add(orderbook_base_new)
    );
    cvt_assert!(
        withdrawable_quote_old.saturating_add(orderbook_quote_old)
            == withdrawable_quote_new.saturating_add(orderbook_quote_new)
    );
}

pub fn cvt_assert_deposit_extra<const IS_BASE: bool>(
    balances_old: AllBalances,
    balances_new: AllBalances,
    amount: u64,
) {
    let AllBalances {
        vault_base: vault_base_old,
        vault_quote: vault_quote_old,
        withdrawable_base: withdrawable_base_old,
        orderbook_base: orderbook_base_old,
        withdrawable_quote: withdrawable_quote_old,
        orderbook_quote: orderbook_quote_old,
        trader_base: trader_base_old,
        trader_quote: trader_quote_old,
        maker_trader_base: _maker_trader_base_old,
        maker_trader_quote: _maker_trader_quote_old,
        maker_order_base: _maker_order_base_old,
        maker_order_quote: _maker_order_quote_old,
    } = balances_old;

    let AllBalances {
        vault_base: vault_base_new,
        vault_quote: vault_quote_new,
        withdrawable_base: withdrawable_base_new,
        orderbook_base: orderbook_base_new,
        withdrawable_quote: withdrawable_quote_new,
        orderbook_quote: orderbook_quote_new,
        trader_base: trader_base_new,
        trader_quote: trader_quote_new,
        maker_trader_base: _maker_trader_base_new,
        maker_trader_quote: _maker_trader_quote_new,
        maker_order_base: _maker_order_base_new,
        maker_order_quote: _maker_order_quote_new,
    } = balances_new;

    cvt_assert!(orderbook_base_old == orderbook_base_new);
    cvt_assert!(orderbook_quote_old == orderbook_quote_new);
    if IS_BASE {
        cvt_assert!(trader_quote_new == trader_quote_old);
        cvt_assert!(withdrawable_quote_new == withdrawable_quote_old);
        cvt_assert!(vault_quote_new == vault_quote_old);
        cvt_assert!(trader_base_old.saturating_add(amount) == trader_base_new);
        cvt_assert!(vault_base_old.saturating_add(amount) == vault_base_new);
    } else {
        cvt_assert!(trader_base_new == trader_base_old);
        cvt_assert!(withdrawable_base_new == withdrawable_base_old);
        cvt_assert!(vault_base_new == vault_base_old);
        cvt_assert!(trader_quote_old.saturating_add(amount) == trader_quote_new);
        cvt_assert!(vault_quote_old.saturating_add(amount) == vault_quote_new);
    }
}

pub fn cvt_assert_withdraw_extra<const IS_BASE: bool>(
    balances_old: AllBalances,
    balances_new: AllBalances,
    amount: u64,
) {
    let AllBalances {
        vault_base: vault_base_old,
        vault_quote: vault_quote_old,
        withdrawable_base: withdrawable_base_old,
        orderbook_base: orderbook_base_old,
        withdrawable_quote: withdrawable_quote_old,
        orderbook_quote: orderbook_quote_old,
        trader_base: trader_base_old,
        trader_quote: trader_quote_old,
        maker_trader_base: _maker_trader_base_old,
        maker_trader_quote: _maker_trader_quote_old,
        maker_order_base: _maker_order_base_old,
        maker_order_quote: _maker_order_quote_old,
    } = balances_old;

    let AllBalances {
        vault_base: vault_base_new,
        vault_quote: vault_quote_new,
        withdrawable_base: withdrawable_base_new,
        orderbook_base: orderbook_base_new,
        withdrawable_quote: withdrawable_quote_new,
        orderbook_quote: orderbook_quote_new,
        trader_base: trader_base_new,
        trader_quote: trader_quote_new,
        maker_trader_base: _maker_trader_base_new,
        maker_trader_quote: _maker_trader_quote_new,
        maker_order_base: _maker_order_base_new,
        maker_order_quote: _maker_order_quote_new,
    } = balances_new;

    cvt_assert!(orderbook_base_old == orderbook_base_new);
    cvt_assert!(orderbook_quote_old == orderbook_quote_new);
    if IS_BASE {
        cvt_assert!(trader_quote_new == trader_quote_old);
        cvt_assert!(withdrawable_quote_new == withdrawable_quote_old);
        cvt_assert!(vault_quote_new == vault_quote_old);
        cvt_assert!(trader_base_old.saturating_sub(amount) == trader_base_new);
        cvt_assert!(vault_base_old.saturating_sub(amount) == vault_base_new);
    } else {
        cvt_assert!(trader_base_new == trader_base_old);
        cvt_assert!(withdrawable_base_new == withdrawable_base_old);
        cvt_assert!(vault_base_new == vault_base_old);
        cvt_assert!(trader_quote_old.saturating_sub(amount) == trader_quote_new);
        cvt_assert!(vault_quote_old.saturating_sub(amount) == vault_quote_new);
    }
}
