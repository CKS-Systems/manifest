use std::cell::RefMut;

use crate::{
    logs::{emit_stack, WithdrawLog},
    market_vault_seeds_with_bump,
    program::get_mut_dynamic_account,
    state::MarketRefMut,
    validation::loaders::WithdrawContext,
};
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program::invoke_signed, pubkey::Pubkey,
};

#[derive(BorshDeserialize, BorshSerialize)]
pub struct WithdrawParams {
    pub amount_atoms: u64,
}

impl WithdrawParams {
    pub fn new(amount_atoms: u64) -> Self {
        WithdrawParams { amount_atoms }
    }
}

pub(crate) fn process_withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let withdraw_context: WithdrawContext = WithdrawContext::load(accounts)?;
    let WithdrawParams { amount_atoms } = WithdrawParams::try_from_slice(data)?;

    let WithdrawContext {
        market,
        payer,
        trader_token,
        vault,
        token_program,
        mint,
    } = withdraw_context;

    let market_data: &mut RefMut<&mut [u8]> = &mut market.try_borrow_mut_data()?;
    let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);

    // Validation verifies that the mint is either base or quote.
    let is_base: bool =
        &trader_token.try_borrow_data()?[0..32] == dynamic_account.get_base_mint().as_ref();

    let mint_key: &Pubkey = if is_base {
        dynamic_account.get_base_mint()
    } else {
        dynamic_account.get_quote_mint()
    };

    let bump: u8 = if is_base {
        dynamic_account.fixed.get_base_vault_bump()
    } else {
        dynamic_account.fixed.get_quote_vault_bump()
    };

    if *vault.owner == spl_token_2022::id() {
        invoke_signed(
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
                vault.as_ref().clone(),
                mint.as_ref().clone(),
                trader_token.as_ref().clone(),
                payer.as_ref().clone(),
            ],
            market_vault_seeds_with_bump!(market.key, mint_key, bump),
        )?;
    } else {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                vault.key,
                trader_token.key,
                vault.key,
                &[],
                amount_atoms,
            )?,
            &[
                token_program.as_ref().clone(),
                vault.as_ref().clone(),
                trader_token.as_ref().clone(),
            ],
            market_vault_seeds_with_bump!(market.key, mint_key, bump),
        )?;
    }

    dynamic_account.withdraw(payer.key, amount_atoms, is_base)?;

    emit_stack(WithdrawLog {
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
