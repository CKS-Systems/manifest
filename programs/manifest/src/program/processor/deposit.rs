use crate::{
    logs::{emit_stack, DepositLog},
    state::MarketRefMut,
    validation::{
        loaders::DepositContext, MintAccountInfo, Signer, TokenAccountInfo, TokenProgram,
    },
};
use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::DataIndex;
use pinocchio::{
    account_info::{AccountInfo, RefMut},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use super::{get_trader_index_with_hint, shared::get_mut_dynamic_account};

#[cfg(feature = "certora")]
use early_panic::early_panic;
#[cfg(feature = "certora")]
use solana_cvt::token::{spl_token_2022_transfer, spl_token_transfer};

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

pub(crate) fn process_deposit(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let params: DepositParams =
        DepositParams::try_from_slice(data).map_err(|_| ProgramError::InvalidAccountData)?;
    process_deposit_core(accounts, params)
}

#[cfg_attr(all(feature = "certora", not(feature = "certora-test")), early_panic)]
pub(crate) fn process_deposit_core(
    accounts: &[AccountInfo],
    params: DepositParams,
) -> ProgramResult {
    let deposit_context: DepositContext = DepositContext::load(accounts)?;
    let DepositParams {
        amount_atoms,
        trader_index_hint,
    } = params;
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

    let market_data: &mut RefMut<[u8]> = &mut market.try_borrow_mut_data()?;
    let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);

    // Validation already verifies that the mint is either base or quote.
    let is_base: bool =
        &trader_token.try_borrow_data()?[0..32] == dynamic_account.get_base_mint().as_ref();

    if *vault.owner() == spl_token_2022::id().to_bytes() {
        let before_vault_balance_atoms: u64 = vault.get_balance_atoms();
        spl_token_2022_transfer_from_trader_to_vault(
            &token_program,
            &trader_token,
            Some(mint),
            if is_base {
                dynamic_account.fixed.get_base_mint()
            } else {
                dynamic_account.get_quote_mint()
            },
            &vault,
            &payer,
            amount_atoms,
            if is_base {
                dynamic_account.fixed.get_base_mint_decimals()
            } else {
                dynamic_account.fixed.get_quote_mint_decimals()
            },
        )?;

        let after_vault_balance_atoms: u64 = vault.get_balance_atoms();
        deposited_amount_atoms = after_vault_balance_atoms
            .checked_sub(before_vault_balance_atoms)
            .unwrap();
    } else {
        spl_token_transfer_from_trader_to_vault(
            &token_program,
            &trader_token,
            &vault,
            &payer,
            amount_atoms,
        )?;
    }

    let trader_index: DataIndex =
        get_trader_index_with_hint(trader_index_hint, &dynamic_account, &payer)?;
    dynamic_account.deposit(trader_index, deposited_amount_atoms, is_base)?;

    emit_stack(DepositLog {
        market: *market.key(),
        trader: *payer.key(),
        mint: if is_base {
            *dynamic_account.get_base_mint()
        } else {
            *dynamic_account.get_quote_mint()
        },
        amount_atoms: deposited_amount_atoms,
    })?;

    Ok(())
}

/** Transfer from base (quote) trader to base (quote) vault using SPL Token **/
#[cfg(not(feature = "certora"))]
fn spl_token_transfer_from_trader_to_vault<'a>(
    _token_program: &TokenProgram<'a>,
    trader_account: &TokenAccountInfo<'a>,
    vault: &TokenAccountInfo<'a>,
    payer: &Signer<'a>,
    amount: u64,
) -> ProgramResult {
    Transfer {
        from: &trader_account,
        to: &vault,
        authority: &payer,
        amount,
    }
    .invoke()
}
#[cfg(feature = "certora")]
/** (Summary) Transfer from base (quote) trader to base (quote) vault using SPL Token **/
fn spl_token_transfer_from_trader_to_vault<'a>(
    _token_program: &TokenProgram<'a>,
    trader_account: &TokenAccountInfo<'a>,
    vault: &TokenAccountInfo<'a>,
    payer: &Signer<'a>,
    amount: u64,
) -> ProgramResult {
    spl_token_transfer(trader_account.info, vault.info, payer.info, amount)
}

/** Transfer from base (quote) trader to base (quote) vault using SPL Token 2022 **/
#[cfg(not(feature = "certora"))]
fn spl_token_2022_transfer_from_trader_to_vault<'a>(
    token_program: &TokenProgram<'a>,
    trader_account: &TokenAccountInfo<'a>,
    mint: Option<MintAccountInfo<'a>>,
    mint_pubkey: &Pubkey,
    vault: &TokenAccountInfo<'a>,
    payer: &Signer<'a>,
    amount: u64,
    decimals: u8,
) -> ProgramResult {
    crate::program::invoke(
        &spl_token_2022::instruction::transfer_checked(
            token_program.key(),
            trader_account.key(),
            mint_pubkey,
            vault.key(),
            payer.key(),
            &[],
            amount,
            decimals,
        )?,
        &[
            token_program.as_ref().clone(),
            trader_account.as_ref().clone(),
            vault.as_ref().clone(),
            mint.unwrap().as_ref().clone(),
            payer.as_ref().clone(),
        ],
    )
}

#[cfg(feature = "certora")]
/** (Summary) Transfer from base (quote) trader to base (quote) vault using SPL Token 2022 **/
fn spl_token_2022_transfer_from_trader_to_vault<'a>(
    _token_program: &TokenProgram<'a>,
    trader_account: &TokenAccountInfo<'a>,
    _mint: Option<MintAccountInfo<'a>>,
    _mint_pubkey: &Pubkey,
    vault: &TokenAccountInfo<'a>,
    payer: &Signer<'a>,
    amount: u64,
    _decimals: u8,
) -> ProgramResult {
    spl_token_2022_transfer(trader_account.info, vault.info, payer.info, amount)
}
