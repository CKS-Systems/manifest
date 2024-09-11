use std::cell::RefMut;

use crate::{
    logs::{emit_stack, DepositLog},
    state::MarketRefMut,
    validation::loaders::DepositContext,
};
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program::invoke, pubkey::Pubkey,
};

use super::shared::get_mut_dynamic_account;

#[derive(BorshDeserialize, BorshSerialize)]
pub struct DepositParams {
    pub amount_atoms: u64,
}

impl DepositParams {
    pub fn new(amount_atoms: u64) -> Self {
        DepositParams { amount_atoms }
    }
}

pub(crate) fn process_deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let deposit_context: DepositContext = DepositContext::load(accounts)?;
    let DepositParams { amount_atoms } = DepositParams::try_from_slice(data)?;

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
        invoke(
            &spl_token_2022::instruction::transfer_checked(
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
            )?,
            &[
                token_program.as_ref().clone(),
                trader_token.as_ref().clone(),
                mint.as_ref().clone(),
                vault.as_ref().clone(),
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
                trader_token.key,
                vault.key,
                payer.key,
                &[],
                amount_atoms,
            )?,
            &[
                token_program.as_ref().clone(),
                trader_token.as_ref().clone(),
                vault.as_ref().clone(),
                payer.as_ref().clone(),
            ],
        )?;
    }

    dynamic_account.deposit(payer.key, amount_atoms, is_base)?;

    emit_stack(DepositLog {
        market: *market.key,
        trader: *payer.key,
        mint: if is_base {
            *dynamic_account.get_base_mint()
        } else {
            *dynamic_account.get_quote_mint()
        },
        amount_atoms,
    })?;

    Ok(())
}
