use std::cell::RefMut;

use crate::{
    global_vault_seeds_with_bump,
    program::{assert_with_msg, get_mut_dynamic_account, ManifestError},
    quantities::{GlobalAtoms, WrapperU64},
    validation::{loaders::GlobalTradeAccounts, MintAccountInfo},
};
use hypertree::{DataIndex, NIL};
#[cfg(not(feature = "no-clock"))]
use solana_program::sysvar::Sysvar;
use solana_program::{
    entrypoint::ProgramResult, program::invoke_signed, program_error::ProgramError, pubkey::Pubkey,
};

use super::{
    order_type_can_take, GlobalRefMut, OrderType, RestingOrder, GAS_DEPOSIT_LAMPORTS,
    NO_EXPIRATION_LAST_VALID_SLOT,
};

pub(crate) fn get_now_slot() -> u32 {
    // If we cannot get the clock (happens in tests, then only match with
    // orders without expiration). We assume that the clock cannot be
    // maliciously manipulated to clear all orders with expirations on the
    // orderbook.
    #[cfg(feature = "no-clock")]
    let now_slot: u64 = u64::MAX;
    #[cfg(not(feature = "no-clock"))]
    let now_slot: u64 = solana_program::clock::Clock::get()
        .unwrap_or(solana_program::clock::Clock {
            slot: u64::MAX,
            epoch_start_timestamp: i64::MAX,
            epoch: u64::MAX,
            leader_schedule_epoch: u64::MAX,
            unix_timestamp: i64::MAX,
        })
        .slot;
    now_slot as u32
}

pub(crate) fn remove_from_global(
    global_trade_accounts_opt: &Option<GlobalTradeAccounts>,
) -> ProgramResult {
    assert_with_msg(
        global_trade_accounts_opt.is_some(),
        ManifestError::MissingGlobal,
        "Missing global accounts when cancelling a global",
    )?;
    let global_trade_accounts: &GlobalTradeAccounts = &global_trade_accounts_opt.as_ref().unwrap();
    let GlobalTradeAccounts { global, trader, .. } = global_trade_accounts;
    {
        let global_data: &mut RefMut<&mut [u8]> = &mut global.try_borrow_mut_data()?;
        let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);
        global_dynamic_account.remove_order(trader.key, global_trade_accounts)?;
    }

    **global.lamports.borrow_mut() -= GAS_DEPOSIT_LAMPORTS;
    **trader.lamports.borrow_mut() += GAS_DEPOSIT_LAMPORTS;

    Ok(())
}

pub(crate) fn try_to_add_to_global(
    global_trade_accounts_opt: &Option<GlobalTradeAccounts>,
    resting_order: &RestingOrder,
) -> ProgramResult {
    assert_with_msg(
        global_trade_accounts_opt.is_some(),
        ManifestError::MissingGlobal,
        "Missing global accounts when adding a global",
    )?;
    let global_trade_accounts: &GlobalTradeAccounts = &global_trade_accounts_opt.as_ref().unwrap();
    let GlobalTradeAccounts { global, trader, .. } = global_trade_accounts;

    {
        let global_data: &mut RefMut<&mut [u8]> = &mut global.try_borrow_mut_data()?;
        let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);
        global_dynamic_account.add_order(resting_order, trader.key)?;
    }

    // Need to CPI because otherwise we get:
    //
    // instruction spent from the balance of an account it does not own
    //
    // Done here instead of inside the object because the borrow checker needs
    // to get the data on global which it cannot while there is a mut self
    // reference.
    solana_program::program::invoke(
        &solana_program::system_instruction::transfer(
            &trader.info.key,
            &global.key,
            GAS_DEPOSIT_LAMPORTS,
        ),
        &[trader.info.clone(), global.info.clone()],
    )?;

    Ok(())
}

pub(crate) fn assert_can_take(order_type: OrderType) -> ProgramResult {
    assert_with_msg(
        order_type_can_take(order_type),
        ManifestError::PostOnlyCrosses,
        "Post only order would cross",
    )?;
    Ok(())
}

pub(crate) fn assert_not_already_expired(last_valid_slot: u32, now_slot: u32) -> ProgramResult {
    assert_with_msg(
        last_valid_slot == NO_EXPIRATION_LAST_VALID_SLOT || last_valid_slot > now_slot,
        ManifestError::AlreadyExpired,
        &format!(
            "Placing an already expired order. now: {} last_valid: {}",
            now_slot, last_valid_slot
        ),
    )?;
    Ok(())
}

pub(crate) fn assert_already_has_seat(trader_index: DataIndex) -> ProgramResult {
    assert_with_msg(
        trader_index != NIL,
        ManifestError::AlreadyClaimedSeat,
        "Need to claim a seat first",
    )?;
    Ok(())
}

pub(crate) fn try_to_move_global_tokens<'a, 'info>(
    global_trade_accounts_opt: &'a Option<GlobalTradeAccounts<'a, 'info>>,
    resting_order_trader: &Pubkey,
    desired_global_atoms: GlobalAtoms,
) -> Result<bool, ProgramError> {
    assert_with_msg(
        global_trade_accounts_opt.is_some(),
        ManifestError::MissingGlobal,
        "Missing global accounts when adding a global",
    )?;
    let global_trade_accounts: &GlobalTradeAccounts = &global_trade_accounts_opt.as_ref().unwrap();
    let GlobalTradeAccounts {
        global,
        mint,
        global_vault,
        market_vault,
        token_program,
        ..
    } = global_trade_accounts;

    let global_data: &mut RefMut<&mut [u8]> = &mut global.try_borrow_mut_data()?;
    let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);

    let num_deposited_atoms: GlobalAtoms =
        global_dynamic_account.get_balance_atoms(resting_order_trader)?;
    if desired_global_atoms > num_deposited_atoms {
        return Ok(false);
    }
    // TODO: Allow matching against a global that can only partially fill the order.

    // Update the GlobalTrader
    global_dynamic_account.reduce(resting_order_trader, desired_global_atoms)?;
    global_dynamic_account.remove_order(resting_order_trader, global_trade_accounts)?;

    let mint_key: &Pubkey = global_dynamic_account.fixed.get_mint();

    let global_vault_bump: u8 = global_dynamic_account.fixed.get_vault_bump();
    if *token_program.key == spl_token_2022::id() {
        assert_with_msg(
            mint.is_some(),
            ManifestError::MissingGlobal,
            "Missing global mint",
        )?;
        let mint_account_info: &MintAccountInfo = mint.as_ref().unwrap();
        invoke_signed(
            &spl_token_2022::instruction::transfer_checked(
                token_program.key,
                global_vault.key,
                mint_account_info.info.key,
                market_vault.key,
                global_vault.key,
                &[],
                desired_global_atoms.as_u64(),
                mint_account_info.mint.decimals,
            )?,
            &[
                token_program.as_ref().clone(),
                global_vault.as_ref().clone(),
                mint_account_info.as_ref().clone(),
                market_vault.as_ref().clone(),
            ],
            global_vault_seeds_with_bump!(mint_key, global_vault_bump),
        )?;
    } else {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                global_vault.key,
                market_vault.key,
                global_vault.key,
                &[],
                desired_global_atoms.as_u64(),
            )?,
            &[
                token_program.as_ref().clone(),
                global_vault.as_ref().clone(),
                market_vault.as_ref().clone(),
            ],
            global_vault_seeds_with_bump!(mint_key, global_vault_bump),
        )?;
    }

    Ok(true)
}
