use ephemeral_rollups_sdk::cpi::undelegate_account;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};

pub fn process_undelegate_market(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    pda_seeds: Vec<Vec<u8>>,
) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let delegated_pda = next_account_info(account_info_iter)?;
    let delegation_buffer = next_account_info(account_info_iter)?;
    let initializer = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    // CPI on Solana
    undelegate_account(
        delegated_pda,
        program_id,
        delegation_buffer,
        initializer,
        system_program,
        pda_seeds,
    )?;

    Ok(())
}
