use std::cell::RefMut;

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program::invoke, pubkey::Pubkey,
};

use crate::{
    logs::{emit_stack, GlobalDepositLog},
    program::get_mut_dynamic_account,
    quantities::{GlobalAtoms, WrapperU64},
    state::GlobalRefMut,
    validation::loaders::GlobalDepositContext,
};

#[derive(BorshDeserialize, BorshSerialize)]
pub struct GlobalDepositParams {
    pub amount_atoms: u64,
}

impl GlobalDepositParams {
    pub fn new(amount_atoms: u64) -> Self {
        GlobalDepositParams { amount_atoms }
    }
}

pub(crate) fn process_global_deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let global_deposit_context: GlobalDepositContext = GlobalDepositContext::load(accounts)?;
    let GlobalDepositParams { amount_atoms } = GlobalDepositParams::try_from_slice(data)?;

    let GlobalDepositContext {
        payer,
        global,
        mint,
        global_vault,
        trader_token: trader_token_account,
        token_program,
    } = global_deposit_context;

    let global_data: &mut RefMut<&mut [u8]> = &mut global.try_borrow_mut_data()?;
    let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);
    global_dynamic_account.deposit_global(payer.key, GlobalAtoms::new(amount_atoms))?;

    // Do the token transfer
    if *global_vault.owner == spl_token_2022::id() {
        invoke(
            &spl_token_2022::instruction::transfer_checked(
                token_program.key,
                trader_token_account.key,
                mint.info.key,
                global_vault.key,
                payer.key,
                &[],
                amount_atoms,
                mint.mint.decimals,
            )?,
            &[
                token_program.as_ref().clone(),
                trader_token_account.as_ref().clone(),
                mint.as_ref().clone(),
                global_vault.as_ref().clone(),
                payer.as_ref().clone(),
            ],
        )?;
        // TODO: Check the actual amount received and use that as the
        // amount_atoms, rather than what the user said because of transfer
        // fees.
    } else {
        invoke(
            &spl_token::instruction::transfer(
                token_program.key,
                trader_token_account.key,
                global_vault.key,
                payer.key,
                &[],
                amount_atoms,
            )?,
            &[
                token_program.as_ref().clone(),
                trader_token_account.as_ref().clone(),
                global_vault.as_ref().clone(),
                payer.as_ref().clone(),
            ],
        )?;
    }

    emit_stack(GlobalDepositLog {
        global: *global.key,
        trader: *payer.key,
        global_atoms: GlobalAtoms::new(amount_atoms),
    })?;

    Ok(())
}
