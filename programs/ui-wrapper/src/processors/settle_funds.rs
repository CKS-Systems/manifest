use std::{cell::RefMut, str::FromStr};

use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::{get_mut_helper, DataIndex, RBNode};
use manifest::{
    program::{get_mut_dynamic_account, withdraw_instruction},
    quantities::{QuoteAtoms, WrapperU64},
    state::{DynamicAccount, MarketFixed},
    validation::{ManifestAccountInfo, Program, Signer},
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{market_info::MarketInfo, wrapper_state::ManifestWrapperStateFixed};

use super::shared::{
    check_signer, get_market_info_index_for_market, sync_fast, WrapperStateAccountInfo,
};

const FEE_DENOMINATOR: u128 = 10u128.pow(9);

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct WrapperSettleFundsParams {
    fee_mantissa: u32,
    platform_fee_percent: u8,
}
impl WrapperSettleFundsParams {
    pub fn new(fee_mantissa: u32, platform_fee_percent: u8) -> Self {
        WrapperSettleFundsParams {
            fee_mantissa,
            platform_fee_percent,
        }
    }
}

pub(crate) fn process_settle_funds(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    let owner: Signer = Signer::new(next_account_info(account_iter)?)?;
    let trader_token_account_base: &AccountInfo = next_account_info(account_iter)?;
    let trader_token_account_quote: &AccountInfo = next_account_info(account_iter)?;
    let market: ManifestAccountInfo<MarketFixed> =
        ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
    let vault_base: &AccountInfo = next_account_info(account_iter)?;
    let vault_quote: &AccountInfo = next_account_info(account_iter)?;
    let mint_base: &AccountInfo = next_account_info(account_iter)?;
    let mint_quote: &AccountInfo = next_account_info(account_iter)?;
    let executor_program: Program = Program::new(
        next_account_info(account_iter)?,
        &Pubkey::from_str("EXECM4wjzdCnrtQjHx5hy1r5k31tdvWBPYbqsjSoPfAh").unwrap(),
    )?;
    let token_program_base: &AccountInfo = next_account_info(account_iter)?;
    let token_program_quote: &AccountInfo = next_account_info(account_iter)?;
    let manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id())?;
    let payer: Signer = Signer::new(next_account_info(account_iter)?)?;
    let platform_token_account: &AccountInfo = next_account_info(account_iter)?;
    let referrer_token_account: Result<&AccountInfo, ProgramError> =
        next_account_info(account_iter);

    check_signer(&wrapper_state, owner.key);
    let market_info_index: DataIndex = get_market_info_index_for_market(&wrapper_state, market.key);

    // Do an initial sync to get all existing orders and balances fresh. This is
    // needed for modifying user orders for insufficient funds.
    sync_fast(&wrapper_state, &market, market_info_index)?;

    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state.info.try_borrow_mut_data()?;
    let mut wrapper: DynamicAccount<&mut ManifestWrapperStateFixed, &mut [u8]> =
        get_mut_dynamic_account(&mut wrapper_data);

    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(&mut wrapper.dynamic, market_info_index)
            .get_mut_value();

    let WrapperSettleFundsParams {
        fee_mantissa,
        platform_fee_percent,
    } = WrapperSettleFundsParams::try_from_slice(data)?;

    let fee_amount =
        (market_info.quote_volume_unpaid.as_u64() as u128 * fee_mantissa as u128) / FEE_DENOMINATOR;
    let effective_quote_volume =
        QuoteAtoms::new((fee_amount * FEE_DENOMINATOR / fee_mantissa as u128) as u64);
    market_info.quote_volume_unpaid -= effective_quote_volume;

    let MarketInfo {
        base_balance,
        quote_balance,
        ..
    } = market_info.clone();

    drop(wrapper_data);

    // settle base
    invoke(
        &withdraw_instruction(
            market.key,
            owner.key,
            mint_base.key,
            base_balance.as_u64(),
            trader_token_account_base.key,
            *token_program_base.key,
        ),
        &[
            market.info.clone(),
            owner.info.clone(),
            mint_base.clone(),
            trader_token_account_base.clone(),
            vault_base.clone(),
            token_program_base.clone(),
            manifest_program.info.clone(),
        ],
    )?;

    // settle quote
    invoke(
        &withdraw_instruction(
            market.key,
            owner.key,
            mint_quote.key,
            quote_balance.as_u64(),
            trader_token_account_quote.key,
            *token_program_quote.key,
        ),
        &[
            market.info.clone(),
            owner.info.clone(),
            mint_quote.clone(),
            trader_token_account_quote.clone(),
            vault_quote.clone(),
            token_program_quote.clone(),
            manifest_program.info.clone(),
        ],
    )?;

    // pay fees

    if *vault_quote.owner == spl_token_2022::id() {
        unimplemented!("token2022 not yet supported")
    } else {
        let mut accounts = vec![
            AccountMeta::new_readonly(*token_program_quote.key, false),
            AccountMeta::new(*trader_token_account_quote.key, false),
            AccountMeta::new(*platform_token_account.key, false),
            AccountMeta::new_readonly(*owner.key, true),
        ];
        let mut account_infos = vec![
            token_program_quote.clone(),
            trader_token_account_quote.clone(),
            platform_token_account.clone(),
            owner.info.clone(),
        ];
        if let Ok(referrer_token_account) = referrer_token_account {
            accounts.push(AccountMeta::new(*referrer_token_account.key, false));
            account_infos.push(referrer_token_account.clone())
        }

        invoke(
            &Instruction {
                program_id: *executor_program.info.key,
                accounts,
                data: [
                    vec![4u8],
                    (fee_amount as u64).to_le_bytes().to_vec(),
                    vec![platform_fee_percent],
                ]
                .concat(),
            },
            account_infos.as_slice(),
        )?
    }

    // Sync to get the balance correct and remove any expired orders.
    sync_fast(&wrapper_state, &market, market_info_index)?;

    Ok(())
}
