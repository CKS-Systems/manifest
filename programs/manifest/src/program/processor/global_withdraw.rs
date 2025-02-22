use borsh::{BorshDeserialize, BorshSerialize};
use pinocchio::{
    account_info::{AccountInfo, RefMut},
    program_error::ProgramError,
    ProgramResult,
};
use pinocchio_token::instructions::Transfer;

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
    // No trader index hint because global account is small so there is not much
    // benefit from hinted indices, unlike the market which can get large. Also,
    // seats are not permanent like on a market due to eviction, so it is more
    // likely that a client could send a bad request. Just look it up for them.
}

impl GlobalWithdrawParams {
    pub fn new(amount_atoms: u64) -> Self {
        GlobalWithdrawParams { amount_atoms }
    }
}

pub(crate) fn process_global_withdraw(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let global_withdraw_context: GlobalWithdrawContext = GlobalWithdrawContext::load(accounts)?;
    let GlobalWithdrawParams { amount_atoms } =
        GlobalWithdrawParams::try_from_slice(data).map_err(|_| ProgramError::InvalidAccountData)?;

    let GlobalWithdrawContext {
        payer,
        global,
        mint,
        global_vault,
        trader_token,
        token_program,
    } = global_withdraw_context;

    let global_data: &mut RefMut<[u8]> = &mut global.try_borrow_mut_data()?;
    let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);
    global_dynamic_account.withdraw_global(payer.key(), GlobalAtoms::new(amount_atoms))?;

    let (_, bump) = get_global_vault_address(mint.info.key());

    // Do the token transfer
    if *global_vault.owner() == spl_token_2022::id().to_bytes() {
        todo!()
    } else {
        Transfer {
            from: &global_vault,
            to: &trader_token,
            authority: &global_vault,
            amount: amount_atoms,
        }
        .invoke_signed(&[global_vault_seeds_with_bump!(mint.info.key(), bump)])?;
    }

    emit_stack(GlobalWithdrawLog {
        global: *global.key(),
        trader: *payer.key(),
        global_atoms: GlobalAtoms::new(amount_atoms),
    })?;

    Ok(())
}
