use std::cell::RefMut;

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program::invoke_signed, pubkey::Pubkey,
};

use crate::{
    global_vault_seeds_with_bump,
    logs::{emit_stack, GlobalWithdrawLog},
    program::get_mut_dynamic_account,
    quantities::{GlobalAtoms, WrapperU64},
    state::GlobalRefMut,
    validation::{get_global_vault_address, loaders::GlobalWithdrawContext},
};

#[derive(BorshDeserialize, BorshSerialize)]
pub struct GlobalWithdrawParams {
    pub amount_atoms: u64,
}

impl GlobalWithdrawParams {
    pub fn new(amount_atoms: u64) -> Self {
        GlobalWithdrawParams { amount_atoms }
    }
}

pub(crate) fn process_global_withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let global_withdraw_context: GlobalWithdrawContext = GlobalWithdrawContext::load(accounts)?;
    let GlobalWithdrawParams { amount_atoms } = GlobalWithdrawParams::try_from_slice(data)?;

    let GlobalWithdrawContext {
        payer,
        global,
        mint,
        global_vault,
        trader_token: trader_token_account,
        token_program,
    } = global_withdraw_context;

    let global_data: &mut RefMut<&mut [u8]> = &mut global.try_borrow_mut_data()?;
    let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);
    global_dynamic_account.withdraw_global(payer.key, GlobalAtoms::new(amount_atoms))?;

    let (_, bump) = get_global_vault_address(mint.info.key);

    // Do the token transfer
    if *global_vault.owner == spl_token_2022::id() {
        invoke_signed(
            &spl_token_2022::instruction::transfer_checked(
                token_program.key,
                global_vault.key,
                mint.info.key,
                trader_token_account.key,
                global_vault.key,
                &[],
                amount_atoms,
                mint.mint.decimals,
            )?,
            &[
                token_program.as_ref().clone(),
                trader_token_account.as_ref().clone(),
                mint.as_ref().clone(),
                global_vault.as_ref().clone(),
            ],
            global_vault_seeds_with_bump!(mint.info.key, bump),
        )?;
    } else {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                global_vault.key,
                trader_token_account.key,
                global_vault.key,
                &[],
                amount_atoms,
            )?,
            &[
                token_program.as_ref().clone(),
                global_vault.as_ref().clone(),
                trader_token_account.as_ref().clone(),
            ],
            global_vault_seeds_with_bump!(mint.info.key, bump),
        )?;
    }

    emit_stack(GlobalWithdrawLog {
        global: *global.key,
        trader: *payer.key,
        global_atoms: GlobalAtoms::new(amount_atoms),
    })?;

    Ok(())
}
