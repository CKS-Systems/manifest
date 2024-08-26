//! Manifest is a limit order book exchange on the Solana blockchain.
//!

pub mod logs;
pub mod program;
pub mod quantities;
pub mod state;
pub mod utils;
pub mod validation;

use program::{
    batch_update::process_batch_update, claim_seat::process_claim_seat,
    create_market::process_create_market, deposit::process_deposit, expand_market::process_expand_market,
    global_add_trader::process_global_add_trader, global_claim_seat::process_global_claim_seat,
    global_create::process_global_create, global_deposit::process_global_deposit, process_swap,
    withdraw::process_withdraw, ManifestInstruction,
};
use solana_program::{
    account_info::AccountInfo, declare_id, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "manifest",
    project_url: "https://manifest.trade",
    contacts: "email:britt@cks.systems",
    policy: "",
    preferred_languages: "en",
    source_code: "https://github.com/CKS-Systems/manifest",
    auditors: ""
}

declare_id!("MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms");

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (tag, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    let instruction: ManifestInstruction =
        ManifestInstruction::try_from(*tag).or(Err(ProgramError::InvalidInstructionData))?;

    #[cfg(not(feature = "no-log-ix-name"))]
    solana_program::msg!("Instruction: {:?}", instruction);

    match instruction {
        ManifestInstruction::CreateMarket => {
            process_create_market(program_id, accounts, data)?;
        }
        ManifestInstruction::ClaimSeat => {
            process_claim_seat(program_id, accounts, data)?;
        }
        ManifestInstruction::Deposit => {
            process_deposit(program_id, accounts, data)?;
        }
        ManifestInstruction::Withdraw => {
            process_withdraw(program_id, accounts, data)?;
        }
        ManifestInstruction::Swap => {
            process_swap(program_id, accounts, data)?;
        }
        ManifestInstruction::Expand => {
            process_expand_market(program_id, accounts, data)?;
        }
        ManifestInstruction::BatchUpdate => {
            process_batch_update(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalCreate => {
            process_global_create(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalAddTrader => {
            process_global_add_trader(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalClaimSeat => {
            process_global_claim_seat(program_id, accounts, data)?;
        }
        ManifestInstruction::GlobalDeposit => {
            process_global_deposit(program_id, accounts, data)?;
        }
    }

    Ok(())
}
