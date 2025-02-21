use crate::require;
use pinocchio::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};
use solana_program::system_program;
use std::ops::Deref;

#[derive(Clone)]
pub struct Program<'a> {
    pub info: &'a AccountInfo,
}

impl<'a, 'info> Program<'a> {
    pub fn new(
        info: &'a AccountInfo,
        expected_program_id: &Pubkey,
    ) -> Result<Program<'a>, ProgramError> {
        solana_program::msg!("new program");
        require!(
            info.key() == expected_program_id,
            ProgramError::IncorrectProgramId,
            "Incorrect program id",
        )?;
        Ok(Self { info })
    }
}

/*
impl<'a> AsRef<AccountInfo for Program<'a> {
    fn as_ref(&self) -> &AccountInfo {
        self.info
    }
}
*/

#[derive(Clone)]
pub struct TokenProgram<'a> {
    pub info: &'a AccountInfo,
}

impl<'a, 'info> TokenProgram<'a> {
    pub fn new(info: &'a AccountInfo) -> Result<TokenProgram<'a>, ProgramError> {
        require!(
            *info.key() == spl_token::id().to_bytes()
                || *info.key() == spl_token_2022::id().to_bytes(),
            ProgramError::IncorrectProgramId,
            "Incorrect token program id: {:?}",
            info.key()
        )?;
        Ok(Self { info })
    }
}

impl<'a, 'info> AsRef<AccountInfo> for TokenProgram<'a> {
    fn as_ref(&self) -> &AccountInfo {
        self.info
    }
}

impl<'a> Deref for TokenProgram<'a> {
    type Target = AccountInfo;

    fn deref(&self) -> &Self::Target {
        self.info
    }
}

#[derive(Clone)]
pub struct Signer<'a> {
    pub info: &'a AccountInfo,
}

impl<'a, 'info> Signer<'a> {
    pub fn new(info: &'a AccountInfo) -> Result<Signer<'a>, ProgramError> {
        require!(
            info.is_signer(),
            ProgramError::MissingRequiredSignature,
            "Missing required signature",
        )?;
        Ok(Self { info })
    }

    pub fn new_payer(info: &'a AccountInfo) -> Result<Signer<'a>, ProgramError> {
        require!(
            info.is_writable(),
            ProgramError::InvalidInstructionData,
            "Payer is not writable",
        )?;
        require!(
            info.is_signer(),
            ProgramError::MissingRequiredSignature,
            "Missing required signature for payer",
        )?;
        Ok(Self { info })
    }
}

impl<'a> AsRef<AccountInfo> for Signer<'a> {
    fn as_ref(&self) -> &AccountInfo {
        self.info
    }
}

impl<'a> Deref for Signer<'a> {
    type Target = AccountInfo;

    fn deref(&self) -> &Self::Target {
        self.info
    }
}

#[derive(Clone)]
pub struct EmptyAccount<'a> {
    pub info: &'a AccountInfo,
}

impl<'a, 'info> EmptyAccount<'a> {
    pub fn new(info: &'a AccountInfo) -> Result<EmptyAccount<'a>, ProgramError> {
        require!(
            info.data_is_empty(),
            ProgramError::InvalidAccountData,
            "Account must be uninitialized",
        )?;
        require!(
            info.owner() == &system_program::id().to_bytes(),
            ProgramError::IllegalOwner,
            "Empty accounts must be owned by the system program",
        )?;
        Ok(Self { info })
    }
}

impl<'a, 'info> AsRef<AccountInfo> for EmptyAccount<'a> {
    fn as_ref(&self) -> &AccountInfo {
        self.info
    }
}
