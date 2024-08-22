use crate::program::error::assert_with_msg;
use solana_program::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, system_program,
};
use std::ops::Deref;

#[derive(Clone)]
pub struct Program<'a, 'info> {
    pub info: &'a AccountInfo<'info>,
}

impl<'a, 'info> Program<'a, 'info> {
    pub fn new(
        info: &'a AccountInfo<'info>,
        expected_program_id: &Pubkey,
    ) -> Result<Program<'a, 'info>, ProgramError> {
        assert_with_msg(
            info.key == expected_program_id,
            ProgramError::IncorrectProgramId,
            "Incorrect program id",
        )?;
        Ok(Self { info })
    }
}

impl<'a, 'info> AsRef<AccountInfo<'info>> for Program<'a, 'info> {
    fn as_ref(&self) -> &AccountInfo<'info> {
        self.info
    }
}

#[derive(Clone)]
pub struct TokenProgram<'a, 'info> {
    pub info: &'a AccountInfo<'info>,
}

impl<'a, 'info> TokenProgram<'a, 'info> {
    pub fn new(info: &'a AccountInfo<'info>) -> Result<TokenProgram<'a, 'info>, ProgramError> {
        assert_with_msg(
            *info.key == spl_token::id() || *info.key == spl_token_2022::id(),
            ProgramError::IncorrectProgramId,
            &format!("Incorrect token program id: {:?}", info.key),
        )?;
        Ok(Self { info })
    }
}

impl<'a, 'info> AsRef<AccountInfo<'info>> for TokenProgram<'a, 'info> {
    fn as_ref(&self) -> &AccountInfo<'info> {
        self.info
    }
}

impl<'a, 'info> Deref for TokenProgram<'a, 'info> {
    type Target = AccountInfo<'info>;

    fn deref(&self) -> &Self::Target {
        self.info
    }
}

#[derive(Clone)]
pub struct Signer<'a, 'info> {
    pub info: &'a AccountInfo<'info>,
}

impl<'a, 'info> Signer<'a, 'info> {
    pub fn new(info: &'a AccountInfo<'info>) -> Result<Signer<'a, 'info>, ProgramError> {
        assert_with_msg(
            info.is_signer,
            ProgramError::MissingRequiredSignature,
            "Missing required signature",
        )?;
        Ok(Self { info })
    }

    pub fn new_payer(info: &'a AccountInfo<'info>) -> Result<Signer<'a, 'info>, ProgramError> {
        assert_with_msg(
            info.is_writable,
            ProgramError::InvalidInstructionData,
            "Payer is not writable",
        )?;
        assert_with_msg(
            info.is_signer,
            ProgramError::MissingRequiredSignature,
            "Missing required signature for payer",
        )?;
        Ok(Self { info })
    }
}

impl<'a, 'info> AsRef<AccountInfo<'info>> for Signer<'a, 'info> {
    fn as_ref(&self) -> &AccountInfo<'info> {
        self.info
    }
}

impl<'a, 'info> Deref for Signer<'a, 'info> {
    type Target = AccountInfo<'info>;

    fn deref(&self) -> &Self::Target {
        self.info
    }
}

#[derive(Clone)]
pub struct EmptyAccount<'a, 'info> {
    pub info: &'a AccountInfo<'info>,
}

impl<'a, 'info> EmptyAccount<'a, 'info> {
    pub fn new(info: &'a AccountInfo<'info>) -> Result<EmptyAccount<'a, 'info>, ProgramError> {
        assert_with_msg(
            info.data_is_empty(),
            ProgramError::InvalidAccountData,
            "Account must be uninitialized",
        )?;
        assert_with_msg(
            info.owner == &system_program::id(),
            ProgramError::IllegalOwner,
            "Empty accounts must be owned by the system program",
        )?;
        Ok(Self { info })
    }
}

impl<'a, 'info> AsRef<AccountInfo<'info>> for EmptyAccount<'a, 'info> {
    fn as_ref(&self) -> &AccountInfo<'info> {
        self.info
    }
}
