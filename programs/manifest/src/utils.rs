use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, keccak, program::invoke_signed,
    program_error::ProgramError, pubkey::Pubkey, rent::Rent, system_instruction,
};

/// Canonical discriminant of the given struct. It is the hash of program ID and
/// the name of the type.
pub fn get_discriminant<T>() -> Result<u64, ProgramError> {
    let type_name: &str = std::any::type_name::<T>();
    let discriminant: u64 = u64::from_le_bytes(
        keccak::hashv(&[crate::ID.as_ref(), type_name.as_bytes()]).as_ref()[..8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    Ok(discriminant)
}

/// Send CPI for creating a new account on chain.
pub fn create_account<'a, 'info>(
    payer: &'a AccountInfo<'info>,
    new_account: &'a AccountInfo<'info>,
    system_program: &'a AccountInfo<'info>,
    program_owner: &Pubkey,
    rent: &Rent,
    space: u64,
    seeds: Vec<Vec<u8>>,
) -> ProgramResult {
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            new_account.key,
            rent.minimum_balance(space as usize),
            space,
            program_owner,
        ),
        &[payer.clone(), new_account.clone(), system_program.clone()],
        &[seeds
            .iter()
            .map(|seed| seed.as_slice())
            .collect::<Vec<&[u8]>>()
            .as_slice()],
    )
}

#[test]
fn test_get_discriminant() {
    // Update this when updating program id.
    assert_eq!(
        get_discriminant::<crate::state::MarketFixed>().unwrap(),
        4859840929024028656
    );
}
