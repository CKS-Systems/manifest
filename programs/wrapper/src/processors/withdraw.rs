use std::cell::Ref;

use borsh::BorshDeserialize;
use manifest::{
    program::{get_dynamic_account, withdraw::WithdrawParams, withdraw_instruction},
    state::MarketFixed,
    validation::{ManifestAccountInfo, MintAccountInfo},
};

use manifest::validation::{Program, Signer};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke,
    pubkey::Pubkey,
};

use super::shared::{check_signer, sync, WrapperStateAccountInfo};

pub(crate) fn process_withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id())?;
    let owner: Signer = Signer::new(next_account_info(account_iter)?)?;
    let market: ManifestAccountInfo<MarketFixed> =
        ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
    let trader_token_account: &AccountInfo = next_account_info(account_iter)?;
    let vault: &AccountInfo = next_account_info(account_iter)?;
    let token_program: Program = Program::new(next_account_info(account_iter)?, &spl_token::id())?;
    let payer: Signer = Signer::new(next_account_info(account_iter)?)?;
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    check_signer(&wrapper_state, owner.key);
    let mint_account_info: MintAccountInfo =
        MintAccountInfo::new(next_account_info(account_iter)?)?;

    let market_fixed: Ref<MarketFixed> = market.get_fixed()?;
    let mint: Pubkey = {
        let base_mint: &Pubkey = market_fixed.get_base_mint();
        let quote_mint: &Pubkey = market_fixed.get_quote_mint();
        if &trader_token_account.try_borrow_data()?[0..32] == base_mint.as_ref() {
            *base_mint
        } else {
            *quote_mint
        }
    };
    drop(market_fixed);

    // Params are a direct pass through.
    let WithdrawParams { amount_atoms } = WithdrawParams::try_from_slice(data)?;
    // Call the withdraw CPI
    invoke(
        &withdraw_instruction(
            market.key,
            payer.key,
            &mint,
            amount_atoms,
            trader_token_account.key,
            spl_token::id(),
        ),
        &[
            manifest_program.info.clone(),
            owner.info.clone(),
            market.info.clone(),
            trader_token_account.clone(),
            vault.clone(),
            token_program.info.clone(),
            mint_account_info.info.clone(),
        ],
    )?;

    // Sync
    sync(&wrapper_state, &market)?;

    Ok(())
}
