use std::{cell::Ref, mem::size_of};

use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::{get_helper, DataIndex, RBNode};
use manifest::{
    program::deposit_instruction,
    state::MarketFixed,
    validation::{ManifestAccountInfo, MintAccountInfo, TokenProgram},
};

use manifest::validation::{Program, Signer};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke,
    pubkey::Pubkey,
};

use crate::{market_info::MarketInfo, wrapper_state::ManifestWrapperStateFixed};

use super::shared::{
    check_signer, get_market_info_index_for_market, sync, WrapperStateAccountInfo,
};

#[derive(BorshDeserialize, BorshSerialize)]
pub struct WrapperDepositParams {
    pub amount_atoms: u64,
}

impl WrapperDepositParams {
    pub fn new(amount_atoms: u64) -> Self {
        WrapperDepositParams { amount_atoms }
    }
}

pub(crate) fn process_deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Load account infos.
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id())?;
    let owner: Signer = Signer::new(next_account_info(account_iter)?)?;
    let market: ManifestAccountInfo<MarketFixed> =
        ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
    let trader_token_account: &AccountInfo = next_account_info(account_iter)?;
    let vault: &AccountInfo = next_account_info(account_iter)?;
    let token_program: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    check_signer(&wrapper_state, owner.key);
    let mint_account_info: MintAccountInfo =
        MintAccountInfo::new(next_account_info(account_iter)?)?;

    let market_fixed: Ref<MarketFixed> = market.get_fixed()?;
    let base_mint: Pubkey = *market_fixed.get_base_mint();
    let quote_mint: Pubkey = *market_fixed.get_quote_mint();
    let mint: &Pubkey = if &trader_token_account.try_borrow_data()?[0..32] == base_mint.as_ref() {
        &base_mint
    } else {
        &quote_mint
    };
    drop(market_fixed);

    let WrapperDepositParams { amount_atoms } = WrapperDepositParams::try_from_slice(data)?;

    let wrapper_data: Ref<&mut [u8]> = wrapper_state.info.try_borrow_data()?;
    let (_fixed_data, wrapper_dynamic_data) =
        wrapper_data.split_at(size_of::<ManifestWrapperStateFixed>());

    let market_info_index: DataIndex =
        get_market_info_index_for_market(&wrapper_state, market.info.key);
    let market_info: MarketInfo =
        *get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index).get_value();
    let trader_index_hint: Option<DataIndex> = Some(market_info.trader_index);

    // Call the deposit CPI
    invoke(
        &deposit_instruction(
            market.key,
            owner.key,
            mint,
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

    sync(&wrapper_state, &market)?;

    Ok(())
}
