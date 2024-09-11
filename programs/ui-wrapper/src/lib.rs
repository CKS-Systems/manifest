//! UI-Wrapper program for Manifest
//!

pub mod instruction;
pub mod instruction_builders;
pub mod market_info;
pub mod open_order;
pub mod processors;
pub mod wrapper_state;

use instruction::ManifestWrapperInstruction;
use processors::{
    claim_seat::process_claim_seat, create_wrapper::process_create_wrapper,
    place_order::process_place_order,
};
use solana_program::{
    account_info::AccountInfo, declare_id, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "manifest-ui-wrapper",
    project_url: "",
    contacts: "email:max@mango.markets",
    policy: "",
    preferred_languages: "en",
    source_code: "https://github.com/CKS-Systems/manifest",
    auditors: ""
}

declare_id!("wMNFSTkir3HgyZTsB7uqu3i7FA73grFCptPXgrZjksL");

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

    let instruction: ManifestWrapperInstruction =
        ManifestWrapperInstruction::try_from(*tag).or(Err(ProgramError::InvalidInstructionData))?;

    #[cfg(not(feature = "no-log-ix-name"))]
    solana_program::msg!("Instruction: {:?}", instruction);

    match instruction {
        ManifestWrapperInstruction::CreateWrapper => {
            process_create_wrapper(program_id, accounts, data)?;
        }
        ManifestWrapperInstruction::ClaimSeat => {
            process_claim_seat(program_id, accounts, data)?;
        }
        ManifestWrapperInstruction::PlaceOrder => {
            process_place_order(program_id, accounts, data)?;
        }
        ManifestWrapperInstruction::EditOrder => {
            unimplemented!("todo");
        }
        ManifestWrapperInstruction::CancelOrder => {
            unimplemented!("todo");
        }
        ManifestWrapperInstruction::SettleFunds => {
            unimplemented!("todo");
        }
    }

    Ok(())
}
