use manifest::program::invoke;

use manifest::validation::{Program, Signer};
use solana_program::sysvar::Sysvar;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    pubkey::Pubkey,
    system_program,
};
use std::str::FromStr;

use crate::loader::WrapperStateAccountInfo;

pub(crate) fn process_collect(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    let _system_program: Program =
        Program::new(next_account_info(account_iter)?, &system_program::id())?;
    let collector: Signer = Signer::new(next_account_info(account_iter)?)?;

    let rent: solana_program::rent::Rent = solana_program::rent::Rent::get()?;
    let minimum_balance: u64 = rent.minimum_balance(wrapper_state.data_len());
    let current_balance: u64 = wrapper_state.lamports();

    let lamports_diff: u64 = current_balance.saturating_sub(minimum_balance);

    // Program deployer of the wrapper is allowed to collect the extra rent.
    assert_eq!(
        *collector.key,
        Pubkey::from_str("B6dmr2UAn2wgjdm3T4N1Vjd8oPYRRTguByW7AEngkeL6").unwrap()
    );

    invoke(
        &solana_program::system_instruction::transfer(
            &wrapper_state.as_ref().key,
            &collector.key,
            lamports_diff,
        ),
        &[wrapper_state.info.clone(), collector.as_ref().clone()],
    )?;

    Ok(())
}
