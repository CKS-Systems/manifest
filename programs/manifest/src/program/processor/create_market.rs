use std::mem::size_of;

use crate::{
    logs::{emit_stack, CreateMarketLog},
    program::expand_market_if_needed,
    require,
    state::MarketFixed,
    validation::{get_vault_address, loaders::CreateMarketContext},
};
use hypertree::get_mut_helper;
use pinocchio::{
    account_info::{AccountInfo, Ref},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeAccount3;
use solana_program::{program_pack::Pack, rent::Rent, sysvar::Sysvar};
use spl_token_2022::{
    extension::{
        mint_close_authority::MintCloseAuthority, permanent_delegate::PermanentDelegate,
        BaseStateWithExtensions, ExtensionType, PodStateWithExtensions, StateWithExtensions,
    },
    pod::PodMint,
    state::{Account, Mint},
};

pub(crate) fn process_create_market(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    solana_program::msg!("Creating");
    let create_market_context: CreateMarketContext = CreateMarketContext::load(accounts)?;

    let CreateMarketContext {
        market,
        payer,
        base_mint,
        quote_mint,
        base_vault,
        quote_vault,
        system_program,
        token_program,
        token_program_22,
    } = create_market_context;

    require!(
        base_mint.info.key() != quote_mint.info.key(),
        crate::program::ManifestError::InvalidMarketParameters,
        "Base and quote must be different",
    )?;

    for mint in [base_mint.as_ref(), quote_mint.as_ref()] {
        if *mint.owner() == spl_token_2022::id().to_bytes() {
            let mint_data: Ref<'_, [u8]> = mint.try_borrow_data()?;
            let pool_mint: StateWithExtensions<'_, Mint> =
                StateWithExtensions::<Mint>::unpack(&mint_data)
                    .map_err(|_| ProgramError::InvalidAccountData)?;
            // Closable mints can be replaced with different ones, breaking some saved info on the market.
            if let Ok(extension) = pool_mint.get_extension::<MintCloseAuthority>() {
                let close_authority: Option<solana_program::pubkey::Pubkey> =
                    extension.close_authority.into();
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
                let permanent_delegate: Option<solana_program::pubkey::Pubkey> =
                    extension.delegate.into();
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
        let rent: Rent = Rent::get().map_err(|_| ProgramError::InvalidAccountData)?;
        for (token_account, mint) in [
            (base_vault.as_ref(), base_mint.as_ref()),
            (quote_vault.as_ref(), quote_mint.as_ref()),
        ] {
            // We dont have to deserialize the mint, just check the owner.
            let is_mint_22: bool = *mint.owner() == spl_token_2022::id().to_bytes();
            let token_program_for_mint: Pubkey = if is_mint_22 {
                spl_token_2022::id().to_bytes()
            } else {
                spl_token::id().to_bytes()
            };

            let (_vault_key, bump) = get_vault_address(market.key(), mint.key());
            let seeds: Vec<Vec<u8>> = vec![
                b"vault".to_vec(),
                market.key().as_ref().to_vec(),
                mint.key().as_ref().to_vec(),
                vec![bump],
            ];

            if is_mint_22 {
                todo!()
            } else {
                let space: usize = spl_token::state::Account::LEN;
                CreateAccount {
                    from: &payer,
                    to: token_account,
                    lamports: rent.minimum_balance(space as usize),
                    space: space as u64,
                    owner: &token_program_for_mint,
                }
                .invoke()?;
                InitializeAccount3 {
                    account: token_account,
                    mint,
                    owner: token_account.key(),
                }
                .invoke()?;
            }
        }

        // Do not need to initialize with the system program because it is
        // assumed that it is done already and loaded with rent. That is not at
        // a PDA because we do not want to be restricted to a single market for
        // a pair. If there is lock contention and hotspotting for one market,
        // it could be useful to have a second where it is easier to land
        // transactions. That protection is worth the possibility that users
        // would use an inactive market when multiple exist.

        // Setup the empty market
        let empty_market_fixed: MarketFixed =
            MarketFixed::new_empty(&base_mint, &quote_mint, market.key());
        assert_eq!(market.data_len(), size_of::<MarketFixed>());

        let market_bytes: &mut [u8] = &mut market.try_borrow_mut_data()?[..];
        *get_mut_helper::<MarketFixed>(market_bytes, 0_u32) = empty_market_fixed;

        emit_stack(CreateMarketLog {
            market: *market.key(),
            creator: *payer.key(),
            base_mint: *base_mint.info.key(),
            quote_mint: *quote_mint.info.key(),
        })?;
    }

    // Leave a free block on the market so takers can use and leave it.
    expand_market_if_needed(&payer, &market, &system_program)?;

    Ok(())
}
