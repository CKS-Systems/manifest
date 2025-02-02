use crate::{get_trader_balance, get_trader_index};
use cvt::{cvt_assert, cvt_assume, cvt_vacuity_check};
use cvt_macros::rule;
use nondet::{acc_infos_with_mem_layout, nondet};

use crate::*;
use solana_program::account_info::AccountInfo;

use solana_cvt::token::spl_token_account_get_amount;

use crate::{
    program::{
        deposit::{process_deposit_core, DepositParams},
        get_mut_dynamic_account,
    },
    state::{DynamicAccount, MarketRefMut},
};
use hypertree::DataIndex;
use state::cvt_assume_main_trader_has_seat;

#[rule]
pub fn rule_update_balance() {
    crate::certora::spec::verification_utils::init_static();

    let acc_infos: [AccountInfo; 16] = acc_infos_with_mem_layout!();
    let trader: &AccountInfo = &acc_infos[0];
    let market: &AccountInfo = &acc_infos[1];

    cvt_assume_main_trader_has_seat(trader.key);

    let (base_atoms_old, _quote_atoms_old) = get_trader_balance!(market, &trader.key);

    let trader_index: DataIndex = get_trader_index!(market, &trader.key);

    let amount: u64 = nondet();

    update_balance!(market, trader_index, true, true, amount);

    let (base_atoms, _quote_atoms) = get_trader_balance!(market, &trader.key);
    cvt_assert!(base_atoms == base_atoms_old + amount);

    cvt_vacuity_check!();
}

#[rule]
pub fn rule_deposit_deposits() {
    use state::{cvt_assume_main_trader_has_seat, is_second_seat_taken, second_trader_pk};

    let acc_infos: [AccountInfo; 16] = acc_infos_with_mem_layout!();
    let used_acc_infos: &[AccountInfo] = &acc_infos[..6];
    let trader: &AccountInfo = &used_acc_infos[0];
    let market: &AccountInfo = &used_acc_infos[1];
    let trader_token: &AccountInfo = &used_acc_infos[2];
    let vault_token: &AccountInfo = &used_acc_infos[3];

    // Unrelated trader
    let unrelated_trader: &AccountInfo = &acc_infos[7];

    cvt_assume_main_trader_has_seat(trader.key);

    // -- trader and vault have different token accounts
    cvt_assume!(trader_token.key != vault_token.key);

    cvt_assume!(trader.key != unrelated_trader.key);
    cvt_assume!(unrelated_trader.key == second_trader_pk());
    cvt_assume!(is_second_seat_taken());

    // Non-deterministically chosen amount
    let amount: u64 = nondet();

    // Old seat balances
    let (trader_base_old, trader_quote_old) = get_trader_balance!(market, trader.key);
    let (unrelated_trader_base_old, unrelated_trader_quote_old) =
        get_trader_balance!(market, unrelated_trader.key);

    // Old SPL balances
    let trader_amount_old = spl_token_account_get_amount(trader_token);
    let vault_amount_old = spl_token_account_get_amount(vault_token);

    // Call to deposit
    process_deposit_core(
        &crate::id(),
        &used_acc_infos,
        DepositParams::new(amount, None),
    )
    .unwrap();

    // New SPL balances
    let trader_amount: u64 = spl_token_account_get_amount(trader_token);
    let vault_amount: u64 = spl_token_account_get_amount(vault_token);

    // Difference in SPL balances
    cvt_assert!(trader_amount_old >= trader_amount);
    cvt_assert!(vault_amount >= vault_amount_old);
    let trader_diff: u64 = trader_amount_old - trader_amount;
    let vault_diff: u64 = vault_amount - vault_amount_old;

    // Diffs must equal the amount
    cvt_assert!(trader_diff == amount);
    cvt_assert!(vault_diff == amount);

    // New seat balances
    let (trader_base, trader_quote) = get_trader_balance!(market, trader.key);
    let (unrelated_trader_base, unrelated_trader_quote) =
        get_trader_balance!(market, unrelated_trader.key);

    // Diffs in base/quote seat balance
    let trader_base_diff: u64 = trader_base - trader_base_old;
    let trader_quote_diff: u64 = trader_quote - trader_quote_old;

    // One of the diffs should be amount, the other zero
    cvt_assert!(trader_base_diff + trader_quote_diff == amount);
    cvt_assert!(trader_base_diff == 0 || trader_quote_diff == 0);

    // The balances of an unrelated trader are not changed
    cvt_assert!(
        unrelated_trader_base == unrelated_trader_base_old
            && unrelated_trader_quote == unrelated_trader_quote_old
    );

    cvt_vacuity_check!();
}
