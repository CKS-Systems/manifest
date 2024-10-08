use std::cell::RefMut;

use crate::{
    logs::{emit_stack, DepositLog},
    state::MarketRefMut,
    validation::loaders::DepositContext,
};
use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::DataIndex;
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, instruction::Instruction, pubkey::Pubkey,
};

use super::{get_trader_index_with_hint, shared::get_mut_dynamic_account};

#[derive(BorshDeserialize, BorshSerialize)]
pub struct DepositParams {
    pub amount_atoms: u64,
    pub trader_index_hint: Option<DataIndex>,
}

impl DepositParams {
    pub fn new(amount_atoms: u64, trader_index_hint: Option<DataIndex>) -> Self {
        DepositParams {
            amount_atoms,
            trader_index_hint,
        }
    }
}

pub(crate) fn process_deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let deposit_context: DepositContext = DepositContext::load(accounts)?;
    let DepositParams {
        amount_atoms,
        trader_index_hint,
    } = DepositParams::try_from_slice(data)?;
    // Due to transfer fees, this might not be what you expect.
    let mut deposited_amount_atoms: u64 = amount_atoms;

    let DepositContext {
        market,
        payer,
        trader_token,
        vault,
        token_program,
        mint,
    } = deposit_context;

    let market_data: &mut RefMut<&mut [u8]> = &mut market.try_borrow_mut_data()?;
    let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);

    // Validation already verifies that the mint is either base or quote.
    let is_base: bool =
        &trader_token.try_borrow_data()?[0..32] == dynamic_account.get_base_mint().as_ref();

    if *vault.owner == spl_token_2022::id() {
        let before_vault_balance_atoms: u64 = vault.get_balance_atoms();
        let ix: Instruction = spl_token_2022::instruction::transfer_checked(
            token_program.key,
            trader_token.key,
            if is_base {
                dynamic_account.fixed.get_base_mint()
            } else {
                dynamic_account.get_quote_mint()
            },
            vault.key,
            payer.key,
            &[],
            amount_atoms,
            if is_base {
                dynamic_account.fixed.get_base_mint_decimals()
            } else {
                dynamic_account.fixed.get_quote_mint_decimals()
            },
        )?;
        let account_infos: [AccountInfo<'_>; 5] = [
            token_program.as_ref().clone(),
            trader_token.as_ref().clone(),
            mint.as_ref().clone(),
            vault.as_ref().clone(),
            payer.as_ref().clone(),
        ];
        #[cfg(target_os = "solana")]
        solana_invoke::invoke_unchecked(&ix, &account_infos)?;
        #[cfg(not(target_os = "solana"))]
        solana_program::program::invoke_unchecked(&ix, &account_infos)?;

        let after_vault_balance_atoms: u64 = vault.get_balance_atoms();
        deposited_amount_atoms = after_vault_balance_atoms
            .checked_sub(before_vault_balance_atoms)
            .unwrap();
    } else {
        let ix: Instruction = spl_token::instruction::transfer(
            token_program.key,
            trader_token.key,
            vault.key,
            payer.key,
            &[],
            amount_atoms,
        )?;
        let account_infos: [AccountInfo<'_>; 4] = [
            token_program.as_ref().clone(),
            trader_token.as_ref().clone(),
            vault.as_ref().clone(),
            payer.as_ref().clone(),
        ];
        #[cfg(target_os = "solana")]
        solana_invoke::invoke_unchecked(&ix, &account_infos)?;
        #[cfg(not(target_os = "solana"))]
        solana_program::program::invoke_unchecked(&ix, &account_infos)?;
    }

    let trader_index: DataIndex =
        get_trader_index_with_hint(trader_index_hint, &mut dynamic_account, &payer)?;
    dynamic_account.deposit(trader_index, deposited_amount_atoms, is_base)?;

    emit_stack(DepositLog {
        market: *market.key,
        trader: *payer.key,
        mint: if is_base {
            *dynamic_account.get_base_mint()
        } else {
            *dynamic_account.get_quote_mint()
        },
        amount_atoms: deposited_amount_atoms,
    })?;

    Ok(())
}
