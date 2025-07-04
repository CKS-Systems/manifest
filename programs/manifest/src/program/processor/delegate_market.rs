use ephemeral_rollups_sdk::cpi::{
    delegate_account, DelegateAccounts, DelegateConfig,
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};
use std::cell::Ref;
use crate::{
    state::MarketFixed,
    validation::{ManifestAccountInfo},
};

pub fn process_delegate_market(_program_id: &Pubkey, accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    let market_to_delegate = next_account_info(account_info_iter)?;
    let owner_program = next_account_info(account_info_iter)?;
    let delegation_buffer = next_account_info(account_info_iter)?;
    let delegation_record = next_account_info(account_info_iter)?;
    let delegation_metadata = next_account_info(account_info_iter)?;
    let delegation_program = next_account_info(account_info_iter)?;

    let market_account: ManifestAccountInfo<MarketFixed> = 
        ManifestAccountInfo::<MarketFixed>::new(market_to_delegate)?;
    let market_fixed: Ref<MarketFixed> = market_account.get_fixed()?;
    let base_mint: Pubkey = *market_fixed.get_base_mint();
    let quote_mint: Pubkey = *market_fixed.get_quote_mint();
    
    drop(market_fixed);

    let delegate_accounts = DelegateAccounts {
        payer: initializer,
        pda: market_to_delegate,
        owner_program,
        buffer: delegation_buffer,
        delegation_record,
        delegation_metadata,
        delegation_program,
        system_program,
    };

    let delegate_config = DelegateConfig {
        commit_frequency_ms: 30_000,
        validator: None,
    };

    delegate_account(delegate_accounts, pda_seeds, delegate_config)?;

    Ok(())
}