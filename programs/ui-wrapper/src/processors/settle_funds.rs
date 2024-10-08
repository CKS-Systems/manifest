use std::cell::RefMut;

use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::{get_mut_helper, DataIndex, RBNode};
use manifest::{
    logs::emit_stack,
    program::{get_mut_dynamic_account, invoke, withdraw_instruction},
    quantities::{QuoteAtoms, WrapperU64},
    state::{DynamicAccount, MarketFixed},
    validation::{ManifestAccountInfo, Program, Signer},
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    logs::{PlatformFeeLog, ReferrerFeeLog},
    market_info::MarketInfo,
    wrapper_user::ManifestWrapperUserFixed,
};

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
    let token_program_base: &AccountInfo = next_account_info(account_iter)?;
    let token_program_quote: &AccountInfo = next_account_info(account_iter)?;
    let manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id())?;
    let platform_token_account: &AccountInfo = next_account_info(account_iter)?;
    let referrer_token_account: Result<&AccountInfo, ProgramError> =
        next_account_info(account_iter);

    check_signer(&wrapper_state, owner.key);
    let market_info_index: DataIndex = get_market_info_index_for_market(&wrapper_state, market.key);

    // Do an initial sync to get all existing orders and balances fresh. This is
    // needed for modifying user orders for insufficient funds.
    sync_fast(&wrapper_state, &market, market_info_index)?;

    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state.info.try_borrow_mut_data()?;
    let mut wrapper: DynamicAccount<&mut ManifestWrapperUserFixed, &mut [u8]> =
        get_mut_dynamic_account(&mut wrapper_data);

    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(&mut wrapper.dynamic, market_info_index)
            .get_mut_value();
    let trader_index: DataIndex = market_info.trader_index;

    let WrapperSettleFundsParams {
        fee_mantissa,
        platform_fee_percent,
    } = WrapperSettleFundsParams::try_from_slice(data)?;
    let fee_mantissa = (fee_mantissa as u128).min(FEE_DENOMINATOR);

    // limits:
    // quote_volume_unpaid = [0..u64::MAX]
    // fee_mantissa = [0..FEE_DENOMINATOR]
    // fee_atoms = [0..u64::MAX]
    // intermediate results can extend above u64
    let fee_atoms =
        market_info.quote_volume_unpaid.as_u64() as u128 * fee_mantissa / FEE_DENOMINATOR;
    // limits:
    // quote_volume_paid = [0..quote_volume_unpaid] safe to cast to u64
    // intermediate results can extend above u64
    let quote_volume_paid = QuoteAtoms::new((fee_atoms * FEE_DENOMINATOR / fee_mantissa) as u64);
    // limits:
    // saturating_sub not needed, but doesn't hurt
    market_info.quote_volume_unpaid = market_info
        .quote_volume_unpaid
        .saturating_sub(quote_volume_paid);

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
            Some(trader_index),
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
            Some(trader_index),
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
        // TODO: make sure to use least amount of transfers possible to avoid transfer fee
    } else {
        // limits:
        // fee_atoms = [0..u64::MAX]
        // platform_fee_atoms = [0..fee_atoms]
        // intermediate results can extend above u64
        let platform_fee_atoms = if referrer_token_account.is_ok() {
            (fee_atoms * platform_fee_percent.min(100) as u128 / 100) as u64
        } else {
            fee_atoms as u64
        };

        invoke(
            &spl_token::instruction::transfer(
                token_program_quote.key,
                trader_token_account_quote.key,
                platform_token_account.key,
                owner.key,
                &[],
                platform_fee_atoms,
            )?,
            &[
                token_program_quote.clone(),
                trader_token_account_quote.clone(),
                platform_token_account.clone(),
                owner.info.clone(),
            ],
        )?;

        emit_stack(PlatformFeeLog {
            market: *market.key,
            user: *owner.key,
            platform_token_account: *platform_token_account.key,
            platform_fee: platform_fee_atoms,
        })?;

        if let Ok(referrer_token_account) = referrer_token_account {
            // saturating_sub not needed, but doesn't hurt
            let referrer_fee_atoms = (fee_atoms as u64).saturating_sub(platform_fee_atoms);

            invoke(
                &spl_token::instruction::transfer(
                    token_program_quote.key,
                    trader_token_account_quote.key,
                    referrer_token_account.key,
                    owner.key,
                    &[],
                    referrer_fee_atoms,
                )?,
                &[
                    token_program_quote.clone(),
                    trader_token_account_quote.clone(),
                    referrer_token_account.clone(),
                    owner.info.clone(),
                ],
            )?;

            emit_stack(ReferrerFeeLog {
                market: *market.key,
                user: *owner.key,
                referrer_token_account: *referrer_token_account.key,
                referrer_fee: referrer_fee_atoms,
            })?;
        }
    }

    // Sync to get the balance correct and remove any expired orders.
    sync_fast(&wrapper_state, &market, market_info_index)?;

    Ok(())
}
