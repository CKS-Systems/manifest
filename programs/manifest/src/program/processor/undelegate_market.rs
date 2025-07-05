// use ephemeral_rollups_sdk::{consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID}, cpi::undelegate_account, ephem::commit_accounts};
// use solana_program::{
//     account_info::{next_account_info, AccountInfo},
//     entrypoint::ProgramResult,
//     pubkey::Pubkey,
// };
// use std::cell::Ref;
// use crate::{
//     require,
//     state::MarketFixed,
//     validation::{get_market_address, ManifestAccountInfo},
// };

// pub fn process_undelegate_market(program_id: &Pubkey, accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
//     // Get accounts
//     let account_info_iter = &mut accounts.iter();
//     let initializer = next_account_info(account_info_iter)?;
//     let system_program = next_account_info(account_info_iter)?;
//     let delegated_market = next_account_info(account_info_iter)?;
//     let delegation_buffer = next_account_info(account_info_iter)?;

//     let market_account: ManifestAccountInfo<MarketFixed> = 
//         ManifestAccountInfo::<MarketFixed>::new(delegated_market)?;
//     let market_fixed: Ref<MarketFixed> = market_account.get_fixed()?;
//     let base_mint: Pubkey = *market_fixed.get_base_mint();
//     let quote_mint: Pubkey = *market_fixed.get_quote_mint();

//     let (expected_market_key, market_bump) = get_market_address(&base_mint, &quote_mint);

//     require!(
//         &expected_market_key == market_account.key, 
//         crate::program::ManifestError::InvalidMarketPubkey,
//         "Invalid Market pubkey"
//     )?;

//     let pda_seeds: &[&[u8]] = &[
//         b"market",
//         base_mint.as_ref(),
//         quote_mint.as_ref(),
//         &[market_bump],
//     ];
    
//     drop(market_fixed);

//     undelegate_account(initializer, program_id, delegation_buffer, initializer, system_program, pda_seeds)?;

//     Ok(())
// }
