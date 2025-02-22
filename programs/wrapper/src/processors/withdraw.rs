use std::cell::Ref;

use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::DataIndex;
use manifest::{
    program::{invoke, withdraw_instruction},
    state::MarketFixed,
    validation::{loaders::next_account_info, ManifestAccountInfo, MintAccountInfo, TokenProgram},
};

use manifest::validation::{Program, Signer};
use pinocchio::{account_info::AccountInfo, pubkey::Pubkey, ProgramResult};

use crate::loader::{check_signer, WrapperStateAccountInfo};

use super::shared::{get_trader_index_hint_for_market, sync};

#[derive(BorshDeserialize, BorshSerialize)]
pub struct WrapperWithdrawParams {
    pub amount_atoms: u64,
}

impl WrapperWithdrawParams {
    pub fn new(amount_atoms: u64) -> Self {
        WrapperWithdrawParams { amount_atoms }
    }
}

pub(crate) fn process_withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id().to_bytes())?;
    let owner: Signer = Signer::new(next_account_info(account_iter)?)?;
    let market: ManifestAccountInfo<MarketFixed> =
        ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
    let trader_token_account: &AccountInfo = next_account_info(account_iter)?;
    let vault: &AccountInfo = next_account_info(account_iter)?;
    let token_program: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    check_signer(&wrapper_state, owner.key());
    let mint_account_info: MintAccountInfo =
        MintAccountInfo::new(next_account_info(account_iter)?)?;

    let mint: Pubkey = {
        let market_fixed: Ref<MarketFixed> = market.get_fixed()?;
        let base_mint: &Pubkey = market_fixed.get_base_mint();
        let quote_mint: &Pubkey = market_fixed.get_quote_mint();
        if &trader_token_account.try_borrow_data()?[0..32] == base_mint.as_ref() {
            *base_mint
        } else {
            *quote_mint
        }
    };

    // Params are a direct pass through.
    let WrapperWithdrawParams { amount_atoms } = WrapperWithdrawParams::try_from_slice(data)?;

    let trader_index_hint: Option<DataIndex> =
        get_trader_index_hint_for_market(&wrapper_state, &market.info.key)?;

    // Call the withdraw CPI
    invoke(
        &withdraw_instruction(
            market.key,
            owner.key,
            &mint,
            amount_atoms,
            trader_token_account.key,
            *token_program.key,
            trader_index_hint,
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
