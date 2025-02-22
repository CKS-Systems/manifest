use std::mem::size_of;

use crate::{
    require,
    state::{
        claimed_seat::ClaimedSeat, constants::MARKET_BLOCK_SIZE, DynamicAccount, GlobalFixed,
        MarketFixed, MarketRefMut, GLOBAL_BLOCK_SIZE,
    },
    validation::{ManifestAccount, ManifestAccountInfo, Program, Signer},
};
use bytemuck::Pod;
use hypertree::{get_helper, get_mut_helper, DataIndex, Get, RBNode};
use pinocchio::{
    account_info::{AccountInfo, Ref, RefMut},
    program_error::ProgramError,
    ProgramResult,
};
#[cfg(not(feature = "certora"))]
use solana_program::sysvar::Sysvar;

use super::batch_update::MarketDataTreeNodeType;

pub(crate) fn expand_market_if_needed<'a, T: ManifestAccount + Pod + Clone>(
    payer: &Signer<'a>,
    market_account_info: &ManifestAccountInfo<'a, T>,
    system_program: &Program<'a>,
) -> ProgramResult {
    let need_expand: bool = {
        let market_data: &Ref<[u8]> = &market_account_info.try_borrow_data()?;
        let fixed: &MarketFixed = get_helper::<MarketFixed>(market_data, 0_u32);
        !fixed.has_free_block()
    };

    if !need_expand {
        return Ok(());
    }
    expand_market(payer, market_account_info, system_program)
}

pub(crate) fn expand_market<'a, T: ManifestAccount + Pod + Clone>(
    payer: &Signer<'a>,
    manifest_account: &ManifestAccountInfo<'a, T>,
    system_program: &Program<'a>,
) -> ProgramResult {
    expand_dynamic(payer, manifest_account, system_program, MARKET_BLOCK_SIZE)?;
    expand_market_fixed(manifest_account.info)?;
    Ok(())
}

// Expand is always needed because global doesnt free bytes ever.
pub(crate) fn expand_global<'a, T: ManifestAccount + Pod + Clone>(
    payer: &Signer<'a>,
    manifest_account: &ManifestAccountInfo<'a, T>,
    system_program: &Program<'a>,
) -> ProgramResult {
    // Expand twice because of two trees at once.
    expand_dynamic(payer, manifest_account, system_program, GLOBAL_BLOCK_SIZE)?;
    expand_dynamic(payer, manifest_account, system_program, GLOBAL_BLOCK_SIZE)?;
    expand_global_fixed(manifest_account.info)?;
    Ok(())
}

#[cfg(feature = "certora")]
fn expand_dynamic<'a, T: ManifestAccount + Pod + Clone>(
    _payer: &Signer<'a>,
    _manifest_account: &ManifestAccountInfo<'a, T>,
    _system_program: &Program<'a>,
    _block_size: usize,
) -> ProgramResult {
    Ok(())
}
#[cfg(not(feature = "certora"))]
fn expand_dynamic<'a, T: ManifestAccount + Pod + Clone>(
    payer: &Signer<'a>,
    manifest_account: &ManifestAccountInfo<'a, T>,
    _system_program: &Program<'a>,
    block_size: usize,
) -> ProgramResult {
    // Account types were already validated, so do not need to reverify that the
    // accounts are in order: payer, expandable_account, system_program, ...

    use pinocchio_system::instructions::Transfer;

    let expandable_account: &AccountInfo = manifest_account.info;
    let new_size: usize = expandable_account.data_len() + block_size;

    let rent: solana_program::rent::Rent =
        solana_program::rent::Rent::get().map_err(|_| ProgramError::InvalidArgument)?;
    let new_minimum_balance: u64 = rent.minimum_balance(new_size);
    let old_minimum_balance: u64 = rent.minimum_balance(expandable_account.data_len());
    let lamports_diff: u64 = new_minimum_balance.saturating_sub(old_minimum_balance);

    let payer: &AccountInfo = payer.info;

    Transfer {
        from: payer,
        to: expandable_account,
        lamports: lamports_diff,
    }
    .invoke()?;

    #[cfg(feature = "fuzz")]
    {
        solana_program::program::invoke(
            &solana_program::system_instruction::allocate(expandable_account.key, new_size as u64),
            &[expandable_account.clone(), system_program.clone()],
        )?;
    }
    #[cfg(not(feature = "fuzz"))]
    {
        expandable_account.realloc(new_size, false)?;
    }
    Ok(())
}

fn expand_market_fixed(expandable_account: &AccountInfo) -> ProgramResult {
    let market_data: &mut RefMut<[u8]> = &mut expandable_account.try_borrow_mut_data()?;
    let mut dynamic_account: DynamicAccount<&mut MarketFixed, &mut [u8]> =
        get_mut_dynamic_account(market_data);
    dynamic_account.market_expand()?;
    Ok(())
}

fn expand_global_fixed(expandable_account: &AccountInfo) -> ProgramResult {
    let global_data: &mut RefMut<[u8]> = &mut expandable_account.try_borrow_mut_data()?;
    let mut dynamic_account: DynamicAccount<&mut GlobalFixed, &mut [u8]> =
        get_mut_dynamic_account(global_data);
    dynamic_account.global_expand()?;
    Ok(())
}

/// Generic get dynamic account from the data bytes of the account.
pub fn get_dynamic_account<'a, T: Get>(
    data: &'a Ref<'a, &'a mut [u8]>,
) -> DynamicAccount<&'a T, &'a [u8]> {
    let (fixed_data, dynamic) = data.split_at(size_of::<T>());
    let fixed: &T = get_helper::<T>(fixed_data, 0_u32);

    let dynamic_account: DynamicAccount<&'a T, &'a [u8]> = DynamicAccount { fixed, dynamic };
    dynamic_account
}

/// Generic get mutable dynamic account from the data bytes of the account.
pub fn get_mut_dynamic_account<'a, T: Get>(
    data: &'a mut RefMut<'_, [u8]>,
) -> DynamicAccount<&'a mut T, &'a mut [u8]> {
    let (fixed_data, dynamic) = data.split_at_mut(size_of::<T>());
    let fixed: &mut T = get_mut_helper::<T>(fixed_data, 0_u32);

    let dynamic_account: DynamicAccount<&'a mut T, &'a mut [u8]> =
        DynamicAccount { fixed, dynamic };
    dynamic_account
}

/// Generic get owned dynamic account from the data bytes of the account.
pub fn get_dynamic_value<T: Get>(data: &[u8]) -> DynamicAccount<T, Vec<u8>> {
    let (fixed_data, dynamic_data) = data.split_at(size_of::<T>());
    let market_fixed: &T = get_helper::<T>(fixed_data, 0_u32);

    let dynamic_account: DynamicAccount<T, Vec<u8>> = DynamicAccount {
        fixed: *market_fixed,
        dynamic: (dynamic_data).to_vec(),
    };
    dynamic_account
}

// Uses a MarketRefMut instead of a MarketRef because callers will have mutable data.
pub(crate) fn get_trader_index_with_hint(
    trader_index_hint: Option<DataIndex>,
    dynamic_account: &MarketRefMut,
    payer: &Signer,
) -> Result<DataIndex, ProgramError> {
    let trader_index: DataIndex = match trader_index_hint {
        None => dynamic_account.get_trader_index(payer.key()),
        Some(hinted_index) => {
            verify_trader_index_hint(hinted_index, &dynamic_account, &payer)?;
            hinted_index
        }
    };
    Ok(trader_index)
}

fn verify_trader_index_hint(
    hinted_index: DataIndex,
    dynamic_account: &MarketRefMut,
    payer: &Signer,
) -> ProgramResult {
    require!(
        hinted_index % (MARKET_BLOCK_SIZE as DataIndex) == 0,
        crate::program::ManifestError::WrongIndexHintParams,
        "Invalid trader hint index {} did not align",
        hinted_index,
    )?;
    require!(
        get_helper::<RBNode<ClaimedSeat>>(&dynamic_account.dynamic, hinted_index)
            .get_payload_type()
            == MarketDataTreeNodeType::ClaimedSeat as u8,
        crate::program::ManifestError::WrongIndexHintParams,
        "Invalid trader hint index {} is not a ClaimedSeat",
        hinted_index,
    )?;
    require!(
        payer
            .key()
            .eq(dynamic_account.get_trader_key_by_index(hinted_index)),
        crate::program::ManifestError::WrongIndexHintParams,
        "Invalid trader hint index {} did not match payer",
        hinted_index
    )?;
    Ok(())
}

pub fn invoke(ix: &solana_program::instruction::Instruction, account_infos: &[solana_program::sysvar::slot_history::AccountInfo<'_>]) -> solana_program::entrypoint::ProgramResult {
    #[cfg(target_os = "solana")]
    {
        solana_invoke::invoke_unchecked(ix, account_infos)
    }
    #[cfg(not(target_os = "solana"))]
    {
        solana_program::program::invoke(ix, account_infos)
    }
}