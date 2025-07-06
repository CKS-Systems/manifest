use ephemeral_rollups_sdk::{consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID}, ephem::{commit_and_undelegate_accounts}};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};
use std::cell::Ref;
use crate::{
    require,
    state::MarketFixed,
    validation::{get_market_address, ManifestAccountInfo},
};

pub fn process_commit_and_undelegate_market(_program_id: &Pubkey, accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let market_to_commit = next_account_info(account_info_iter)?;
    let magic_program = next_account_info(account_info_iter)?;
    let magic_context = next_account_info(account_info_iter)?;

    require!(
        magic_program.key == &MAGIC_PROGRAM_ID,
        crate::program::ManifestError::InvalidMagicProgramId,
        "Invalid Magicblock program ID",
    )?;
    require!(
        magic_context.key == &MAGIC_CONTEXT_ID,
        crate::program::ManifestError::InvaliMagicContextId,
        "Invalid Magicblock context ID",
    )?;
    
    let market_account: ManifestAccountInfo<MarketFixed> = 
        ManifestAccountInfo::<MarketFixed>::new_delegated(market_to_commit)?;
    let market_fixed: Ref<MarketFixed> = market_account.get_fixed()?;
    let base_mint: Pubkey = *market_fixed.get_base_mint();
    let quote_mint: Pubkey = *market_fixed.get_quote_mint();

    let (expected_market_key, _market_bump) = get_market_address(&base_mint, &quote_mint);

    require!(
        &expected_market_key == market_account.key, 
        crate::program::ManifestError::InvalidMarketPubkey,
        "Invalid Market pubkey"
    )?;
    
    drop(market_fixed);

    commit_and_undelegate_accounts(
        initializer, 
        vec![market_to_commit], 
        magic_context, 
        magic_program
    )?;

    Ok(())
}
