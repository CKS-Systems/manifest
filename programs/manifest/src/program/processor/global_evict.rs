use borsh::{BorshDeserialize, BorshSerialize};
use pinocchio::{
    account_info::{AccountInfo, RefMut},
    program_error::ProgramError,
    ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::{
    global_vault_seeds_with_bump,
    logs::{emit_stack, GlobalDepositLog, GlobalEvictLog, GlobalWithdrawLog},
    program::get_mut_dynamic_account,
    quantities::{GlobalAtoms, WrapperU64},
    require,
    state::GlobalRefMut,
    validation::{get_global_vault_address, loaders::GlobalEvictContext},
};
use solana_program::program::invoke_signed;

#[derive(BorshDeserialize, BorshSerialize)]
pub struct GlobalEvictParams {
    // Deposit amount that must be greater than the evictee deposit amount
    amount_atoms: u64,
}

impl GlobalEvictParams {
    pub fn new(amount_atoms: u64) -> Self {
        GlobalEvictParams { amount_atoms }
    }
}

pub(crate) fn process_global_evict(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let global_evict_context: GlobalEvictContext = GlobalEvictContext::load(accounts)?;
    let GlobalEvictParams { amount_atoms } =
        GlobalEvictParams::try_from_slice(data).map_err(|_| ProgramError::InvalidAccountData)?;

    let GlobalEvictContext {
        payer,
        global,
        mint,
        global_vault,
        trader_token,
        evictee_token,
        token_program,
    } = global_evict_context;

    // 1. Withdraw for the evictee
    // 2. Evict the seat on the global account and claim
    // 3. Deposit for the evictor
    let global_data: &mut RefMut<[u8]> = &mut global.try_borrow_mut_data()?;
    let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);
    let evictee_balance: GlobalAtoms =
        global_dynamic_account.get_balance_atoms(&evictee_token.get_owner());

    {
        // Do verifications that this is a valid eviction.
        require!(
            evictee_balance < GlobalAtoms::new(amount_atoms),
            crate::program::ManifestError::InvalidEvict,
            "Evictee balance {} is more than evictor wants to deposit",
            evictee_balance.as_u64(),
        )?;
        global_dynamic_account.verify_min_balance(&evictee_token.get_owner())?;
    }

    // Withdraw
    {
        let evictee_balance: GlobalAtoms =
            global_dynamic_account.get_balance_atoms(&evictee_token.get_owner());
        global_dynamic_account.withdraw_global(&evictee_token.get_owner(), evictee_balance)?;

        let (_, bump) = get_global_vault_address(mint.info.key());

        // Do the token transfer
        if *global_vault.owner() == spl_token_2022::id().to_bytes() {
            todo!()
        } else {
            Transfer {
                from: &global_vault.info,
                to: &evictee_token.info,
                authority: &global_vault.info,
                amount: evictee_balance.as_u64(),
            }
            .invoke_signed(&[global_vault_seeds_with_bump!(mint.info.key(), bump)])?;
        }

        emit_stack(GlobalWithdrawLog {
            global: *global.key(),
            trader: *payer.key(),
            global_atoms: GlobalAtoms::new(amount_atoms),
        })?;
    }

    // Evict
    {
        global_dynamic_account
            .evict_and_take_seat(&evictee_token.get_owner(), &trader_token.get_owner())?;

        emit_stack(GlobalEvictLog {
            evictee: evictee_token.get_owner(),
            evictor: trader_token.get_owner(),
            evictor_atoms: GlobalAtoms::new(amount_atoms),
            evictee_atoms: evictee_balance,
        })?;
    }

    // Deposit
    {
        global_dynamic_account.deposit_global(payer.key(), GlobalAtoms::new(amount_atoms))?;

        // Do the token transfer
        if *global_vault.owner() == spl_token_2022::id().to_bytes() {
            todo!()
        } else {
            Transfer {
                from: &trader_token,
                to: &global_vault,
                authority: &payer.info,
                amount: amount_atoms,
            }
            .invoke()?;
        }

        emit_stack(GlobalDepositLog {
            global: *global.key(),
            trader: *payer.key(),
            global_atoms: GlobalAtoms::new(amount_atoms),
        })?;
    }

    Ok(())
}
