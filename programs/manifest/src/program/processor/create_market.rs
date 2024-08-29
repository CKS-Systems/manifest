use std::mem::size_of;

use crate::{
    logs::{emit_stack, CreateMarketLog},
    program::{assert_with_msg, expand_market_if_needed, ManifestError},
    state::MarketFixed,
    utils::create_account,
    validation::{get_vault_address, loaders::CreateMarketContext},
};
use hypertree::{get_mut_helper, trace};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program::invoke, program_pack::Pack,
    pubkey::Pubkey, rent::Rent, sysvar::Sysvar,
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
        token_program,
        token_program_22,
    } = create_market_context;

    assert_with_msg(
        base_mint.info.key != quote_mint.info.key,
        ManifestError::InvalidMarketParameters,
        "Base and quote must be different",
    )?;

    {
        // Create the base and quote vaults of this market
        let rent: Rent = Rent::get()?;
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

            let (_vault_key, bump) = get_vault_address(market.key, mint.key);
            let space: usize = spl_token::state::Account::LEN;
            let seeds: Vec<Vec<u8>> = vec![
                b"vault".to_vec(),
                market.key.as_ref().to_vec(),
                mint.key.as_ref().to_vec(),
                vec![bump],
            ];
            create_account(
                payer.as_ref(),
                token_account,
                system_program.as_ref(),
                &token_program_for_mint,
                &rent,
                space as u64,
                seeds,
            )?;
            if is_mint_22 {
                invoke(
                    &spl_token_2022::instruction::initialize_account3(
                        &token_program_for_mint,
                        token_account.key,
                        mint.key,
                        token_account.key,
                    )?,
                    &[
                        payer.as_ref().clone(),
                        token_account.clone(),
                        mint.clone(),
                        token_program_22.as_ref().clone(),
                    ],
                )?;
            } else {
                invoke(
                    &spl_token::instruction::initialize_account3(
                        &token_program_for_mint,
                        token_account.key,
                        mint.key,
                        token_account.key,
                    )?,
                    &[
                        payer.as_ref().clone(),
                        token_account.clone(),
                        mint.clone(),
                        token_program.as_ref().clone(),
                    ],
                )?;
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
            MarketFixed::new_empty(&base_mint, &quote_mint, market.key);
        assert_eq!(market.data_len(), size_of::<MarketFixed>());

        let market_bytes: &mut [u8] = &mut market.try_borrow_mut_data()?[..];
        *get_mut_helper::<MarketFixed>(market_bytes, 0_u32) = empty_market_fixed;

        emit_stack(CreateMarketLog {
            market: *market.key,
            creator: *payer.key,
        })?;
    }

    // Leave a free block on the market so takers can use and leave it.
    expand_market_if_needed(&payer, &market, &system_program)?;

    Ok(())
}