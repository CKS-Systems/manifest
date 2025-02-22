use borsh::{BorshDeserialize, BorshSerialize};
use pinocchio::{
    account_info::{AccountInfo, RefMut},
    program_error::ProgramError,
    ProgramResult,
};
use pinocchio_token::instructions::Transfer;

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
    // No trader index hint because global account is small so there is not much
    // benefit from hinted indices, unlike the market which can get large. Also,
    // seats are not permanent like on a market due to eviction, so it is more
    // likely that a client could send a bad request. Just look it up for them.
}

impl GlobalDepositParams {
    pub fn new(amount_atoms: u64) -> Self {
        GlobalDepositParams { amount_atoms }
    }
}

pub(crate) fn process_global_deposit(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let global_deposit_context: GlobalDepositContext = GlobalDepositContext::load(accounts)?;
    let GlobalDepositParams { amount_atoms } =
        GlobalDepositParams::try_from_slice(data).map_err(|_| ProgramError::InvalidAccountData)?;
    // Due to transfer fees, this might not be what you expect.
    let mut deposited_amount_atoms: u64 = amount_atoms;

    let GlobalDepositContext {
        payer,
        global,
        mint,
        global_vault,
        trader_token: trader_token_account,
        token_program,
    } = global_deposit_context;

    let global_data: &mut RefMut<[u8]> = &mut global.try_borrow_mut_data()?;
    let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);
    global_dynamic_account.deposit_global(payer.key(), GlobalAtoms::new(amount_atoms))?;

    // Do the token transfer
    if *global_vault.owner() == spl_token_2022::id().to_bytes() {
        todo!()
    } else {
        Transfer {
            from: &trader_token_account,
            to: &global_vault,
            authority: payer.info,
            amount: amount_atoms,
        }
        .invoke()?;
    }

    emit_stack(GlobalDepositLog {
        global: *global.key(),
        trader: *payer.key(),
        global_atoms: GlobalAtoms::new(deposited_amount_atoms),
    })?;

    Ok(())
}
