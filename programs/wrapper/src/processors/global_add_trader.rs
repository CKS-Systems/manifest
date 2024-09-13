use std::cell::RefMut;

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke,
    pubkey::Pubkey,
    system_program,
};

use manifest::{
    program::{global_add_trader_instruction, expand_global_instruction, get_mut_dynamic_account},
    state::{GlobalFixed, GlobalRefMut},
    validation::ManifestAccountInfo,
};

use crate::{
    wrapper_state::ManifestWrapperStateFixed,
    validation::{Program, Signer},
};

use super::shared::{
    check_signer,
    expand_wrapper_if_needed,
    WrapperStateAccountInfo,
};

pub(crate) fn process_global_add_trader(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id())?;
    let owner: Signer = Signer::new(next_account_info(account_iter)?)?;
    let global: ManifestAccountInfo<GlobalFixed> =
        ManifestAccountInfo::<GlobalFixed>::new(next_account_info(account_iter)?)?;
    let system_program: Program =
        Program::new(next_account_info(account_iter)?, &system_program::id())?;
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    check_signer(&wrapper_state, owner.key);

    // Call the Expand Global CPI
    invoke(
        &expand_global_instruction(global.key, owner.key),
        &[
            manifest_program.info.clone(),
            owner.info.clone(),
            global.info.clone(),
            system_program.info.clone(),
        ],
    )?;

    // Call the GlobalAddTrader CPI
    invoke(
        &global_add_trader_instruction(global.key, owner.key),
        &[
            manifest_program.info.clone(),
            owner.info.clone(),
            global.info.clone(),
            system_program.info.clone(),
        ],
    )?;

    // Expand the wrapper state if needed
    expand_wrapper_if_needed(&wrapper_state, &owner, &system_program)?;

    // Update the wrapper state to reflect the new trader
    let wrapper_state_info: &AccountInfo = wrapper_state.info;
    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state_info.try_borrow_mut_data().unwrap();
    let wrapper_fixed: &mut ManifestWrapperStateFixed = ManifestWrapperStateFixed::load_mut(&mut wrapper_data)?;

    // Update the trader in the wrapper state
    wrapper_fixed.trader = *owner.key;

    Ok(())
}