use std::{cell::Ref, mem::size_of};

use crate::{
    logs::{emit_stack, CreateMarketLog},
    program::expand_market_if_needed,
    require,
    state::MarketFixed,
    utils::create_account,
    validation::{get_vault_address, get_market_address, loaders::CreateMarketContext, ManifestAccountInfo},
};
use hypertree::{get_mut_helper, trace};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program_pack::Pack, pubkey::Pubkey,
    rent::Rent, sysvar::Sysvar,
};
use spl_token_2022::{
    extension::{
        mint_close_authority::MintCloseAuthority, permanent_delegate::PermanentDelegate,
        BaseStateWithExtensions, ExtensionType, PodStateWithExtensions, StateWithExtensions,
    },
    pod::PodMint,
    state::{Account, Mint},
};

pub(crate) fn process_create_market(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    trace!("process_create_market accs={accounts:?}");
    let create_market_context: CreateMarketContext = CreateMarketContext::load(accounts)?;

    let CreateMarketContext {
        market,
        payer,
        base_mint,
        quote_mint,
        base_vault,
        quote_vault,
        system_program,
        token_program: _token_program,
        token_program_22,
    } = create_market_context;

    require!(
        base_mint.info.key != quote_mint.info.key,
        crate::program::ManifestError::InvalidMarketParameters,
        "Base and quote must be different",
    )?;

    // Verify the market account is at the expected PDA address
    let (expected_market_key, market_bump) = get_market_address(base_mint.info.key, quote_mint.info.key);
    require!(
        expected_market_key == *market.info.key,
        crate::program::ManifestError::IncorrectAccount,
        "Market account is not at expected PDA address",
    )?;

    // Create the market PDA account
    {
        let market_seeds: Vec<Vec<u8>> = vec![
            b"market".to_vec(),
            base_mint.info.key.as_ref().to_vec(),
            quote_mint.info.key.as_ref().to_vec(),
            vec![market_bump],
        ];

        create_account(
            payer.as_ref(),
            market.as_ref(),
            system_program.as_ref(),
            &crate::id(),
            &Rent::get()?,
            size_of::<MarketFixed>() as u64,
            market_seeds,
        )?;
    }

    for mint in [base_mint.as_ref(), quote_mint.as_ref()] {
        if *mint.owner == spl_token_2022::id() {
            let mint_data: Ref<'_, &mut [u8]> = mint.data.borrow();
            let pool_mint: StateWithExtensions<'_, Mint> =
                StateWithExtensions::<Mint>::unpack(&mint_data)?;
            // Closable mints can be replaced with different ones, breaking some saved info on the market.
            if let Ok(extension) = pool_mint.get_extension::<MintCloseAuthority>() {
                let close_authority: Option<Pubkey> = extension.close_authority.into();
                if close_authority.is_some() {
                    solana_program::msg!(
                        "Warning, you are creating a market with a close authority."
                    );
                }
            }
            // Permanent delegates can steal your tokens. This will break all
            // accounting in the market, so there is no assertion of security
            // against loss of funds on these markets.
            if let Ok(extension) = pool_mint.get_extension::<PermanentDelegate>() {
                let permanent_delegate: Option<Pubkey> = extension.delegate.into();
                if permanent_delegate.is_some() {
                    solana_program::msg!(
                        "Warning, you are creating a market with a permanent delegate. There is no loss of funds protection for funds on this market"
                    );
                }
            }
        }
    }

    {
        // Create the base and quote vaults of this market
        let rent: Rent = Rent::get()?;
        
        // Prepare market seeds for signing
        let market_seeds: &[&[u8]] = &[
            b"market",
            base_mint.info.key.as_ref(),
            quote_mint.info.key.as_ref(),
            &[market_bump],
        ];
        
        for (token_account, mint) in [
            (base_vault.as_ref(), base_mint.as_ref()),
            (quote_vault.as_ref(), quote_mint.as_ref()),
        ] {
            // We dont have to deserialize the mint, just check the owner.
            let is_mint_22: bool = *mint.owner == spl_token_2022::id();
            let token_program_for_mint: Pubkey = if is_mint_22 {
                spl_token_2022::id()
            } else {
                spl_token::id()
            };

            let (_vault_key, bump) = get_vault_address(market.info.key, mint.key);
            let seeds: Vec<Vec<u8>> = vec![
                b"vault".to_vec(),
                market.info.key.as_ref().to_vec(),
                mint.key.as_ref().to_vec(),
                vec![bump],
            ];

            if is_mint_22 {
                let mint_data: Ref<'_, &mut [u8]> = mint.data.borrow();
                let mint_with_extension: PodStateWithExtensions<'_, PodMint> =
                    PodStateWithExtensions::<PodMint>::unpack(&mint_data).unwrap();
                let mint_extensions: Vec<ExtensionType> =
                    mint_with_extension.get_extension_types()?;
                let required_extensions: Vec<ExtensionType> =
                    ExtensionType::get_required_init_account_extensions(&mint_extensions);
                let space: usize =
                    ExtensionType::try_calculate_account_len::<Account>(&required_extensions)?;
                create_account(
                    payer.as_ref(),
                    token_account,
                    system_program.as_ref(),
                    &token_program_for_mint,
                    &rent,
                    space as u64,
                    seeds,
                )?;
                solana_program::program::invoke_signed(
                    &spl_token_2022::instruction::initialize_account3(
                        &token_program_for_mint,
                        token_account.key,
                        mint.key,
                        token_account.key,
                    )?,
                    &[
                        market.info.clone(),
                        token_account.as_ref().clone(),
                        mint.as_ref().clone(),
                        token_program_22.as_ref().clone(),
                    ],
                    &[market_seeds],
                )?;
            } else {
                let space: usize = spl_token::state::Account::LEN;
                create_account(
                    payer.as_ref(),
                    token_account,
                    system_program.as_ref(),
                    &token_program_for_mint,
                    &rent,
                    space as u64,
                    seeds,
                )?;
                solana_program::program::invoke_signed(
                    &spl_token::instruction::initialize_account3(
                        &token_program_for_mint,
                        token_account.key,
                        mint.key,
                        token_account.key,
                    )?,
                    &[
                        market.info.clone(),
                        token_account.as_ref().clone(),
                        mint.as_ref().clone(),
                        token_program_22.as_ref().clone(),
                    ],
                    &[market_seeds],
                )?;
            }
        }

        // Setup the empty market
        let empty_market_fixed: MarketFixed =
            MarketFixed::new_empty(&base_mint, &quote_mint, market.info.key);
        assert_eq!(market.info.data_len(), size_of::<MarketFixed>());

        let market_bytes: &mut [u8] = &mut market.info.try_borrow_mut_data()?[..];
        *get_mut_helper::<MarketFixed>(market_bytes, 0_u32) = empty_market_fixed;

        emit_stack(CreateMarketLog {
            market: *market.info.key,
            creator: *payer.key,
            base_mint: *base_mint.info.key,
            quote_mint: *quote_mint.info.key,
        })?;
    }

    // Convert the market to a ManifestAccountInfo now that it's been created and initialized
    let market_account_info: ManifestAccountInfo<MarketFixed> =
        ManifestAccountInfo::<MarketFixed>::new(market.info)?;

    // Leave a free block on the market so takers can use and leave it.
    expand_market_if_needed(&payer, &market_account_info)?;

    Ok(())
}
