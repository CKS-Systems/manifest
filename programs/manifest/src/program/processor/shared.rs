use std::{
    cell::{Ref, RefMut},
    mem::size_of,
};

use crate::{
    state::{constants::MARKET_BLOCK_SIZE, DynamicAccount, GlobalFixed, MarketFixed},
    validation::{ManifestAccount, ManifestAccountInfo, Program, Signer},
};
use bytemuck::Pod;
use hypertree::{get_helper, get_mut_helper, trace};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program::invoke, rent::Rent,
    system_instruction, sysvar::Sysvar,
};

pub(crate) fn expand_market_if_needed<'a, 'info, T: ManifestAccount + Pod + Clone>(
    payer: &Signer<'a, 'info>,
    manifest_account: &ManifestAccountInfo<'a, 'info, T>,
    system_program: &Program<'a, 'info>,
) -> ProgramResult {
    let need_expand: bool = {
        let market_data: &Ref<&mut [u8]> = &manifest_account.try_borrow_data()?;
        let fixed: &MarketFixed = get_helper::<MarketFixed>(market_data, 0_u32);
        !fixed.has_free_block()
    };

    if !need_expand {
        return Ok(());
    }
    expand_dynamic(payer, manifest_account, system_program)?;
    expand_market_fixed(manifest_account.info)?;
    Ok(())
}

// Expand is always needed because global doesnt free bytes ever.
pub(crate) fn expand_global<'a, 'info, T: ManifestAccount + Pod + Clone>(
    payer: &Signer<'a, 'info>,
    manifest_account: &ManifestAccountInfo<'a, 'info, T>,
    system_program: &Program<'a, 'info>,
) -> ProgramResult {
    expand_dynamic(payer, manifest_account, system_program)?;
    expand_global_fixed(manifest_account.info)?;
    Ok(())
}

fn expand_dynamic<'a, 'info, T: ManifestAccount + Pod + Clone>(
    payer: &Signer<'a, 'info>,
    manifest_account: &ManifestAccountInfo<'a, 'info, T>,
    system_program: &Program<'a, 'info>,
) -> ProgramResult {
    // Account types were already validated, so do not need to reverify that the
    // accounts are in order: payer, expandable_account, system_program, ...
    let expandable_account: &AccountInfo = manifest_account.info;
    let new_size: usize = expandable_account.data_len() + MARKET_BLOCK_SIZE;

    let rent: Rent = Rent::get()?;
    let new_minimum_balance: u64 = rent.minimum_balance(new_size);
    let lamports_diff: u64 = new_minimum_balance.saturating_sub(expandable_account.lamports());

    let payer: &AccountInfo = payer.info;
    let system_program: &AccountInfo = system_program.info;

    trace!(
        "expand_if_needed -> transfer {} {:?}",
        lamports_diff,
        expandable_account.key
    );
    invoke(
        &system_instruction::transfer(payer.key, expandable_account.key, lamports_diff),
        &[
            payer.clone(),
            expandable_account.clone(),
            system_program.clone(),
        ],
    )?;

    trace!(
        "expand_if_needed -> realloc {} {:?}",
        new_size,
        expandable_account.key
    );
    #[cfg(feature = "fuzz")]
    {
        invoke(
            &system_instruction::allocate(expandable_account.key, new_size as u64),
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
    let market_data: &mut RefMut<&mut [u8]> = &mut expandable_account.try_borrow_mut_data()?;
    let mut dynamic_account: DynamicAccount<&mut MarketFixed, &mut [u8]> =
        get_mut_dynamic_account(market_data);
    dynamic_account.market_expand()?;
    Ok(())
}

fn expand_global_fixed(expandable_account: &AccountInfo) -> ProgramResult {
    let global_data: &mut RefMut<&mut [u8]> = &mut expandable_account.try_borrow_mut_data()?;
    let mut dynamic_account: DynamicAccount<&mut GlobalFixed, &mut [u8]> =
        get_mut_dynamic_account(global_data);
    dynamic_account.global_expand()?;
    Ok(())
}

/// Generic get dynamic account from the data bytes of the account.
pub fn get_dynamic_account<'a, T: Pod>(
    data: &'a Ref<'a, &'a mut [u8]>,
) -> DynamicAccount<&'a T, &'a [u8]> {
    let (fixed_data, dynamic) = data.split_at(size_of::<T>());
    let fixed: &T = get_helper::<T>(fixed_data, 0_u32);

    let dynamic_account: DynamicAccount<&'a T, &'a [u8]> = DynamicAccount { fixed, dynamic };
    dynamic_account
}

/// Generic get mutable dynamic account from the data bytes of the account.
pub fn get_mut_dynamic_account<'a, T: Pod>(
    data: &'a mut RefMut<'_, &mut [u8]>,
) -> DynamicAccount<&'a mut T, &'a mut [u8]> {
    let (fixed_data, dynamic) = data.split_at_mut(size_of::<T>());
    let fixed: &mut T = get_mut_helper::<T>(fixed_data, 0_u32);

    let dynamic_account: DynamicAccount<&'a mut T, &'a mut [u8]> =
        DynamicAccount { fixed, dynamic };
    dynamic_account
}

/// Generic get owned dynamic account from the data bytes of the account.
pub fn get_dynamic_value<T: Pod>(data: &[u8]) -> DynamicAccount<T, Vec<u8>> {
    let (fixed_data, dynamic_data) = data.split_at(size_of::<T>());
    let market_fixed: &T = get_helper::<T>(fixed_data, 0_u32);

    let dynamic_account: DynamicAccount<T, Vec<u8>> = DynamicAccount {
        fixed: *market_fixed,
        dynamic: (dynamic_data).to_vec(),
    };
    dynamic_account
}
