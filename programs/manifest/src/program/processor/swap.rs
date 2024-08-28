#![allow(unused_imports)]

use std::borrow::BorrowMut;
use std::cell::RefMut;

use crate::{logs::{emit_stack, PlaceOrderLog}, market_vault_seeds_with_bump, program::ManifestError, quantities::{BaseAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64}, require, state::{
    AddOrderToMarketArgs, AddOrderToMarketResult, MarketRefMut, OrderType,
    NO_EXPIRATION_LAST_VALID_SLOT,
}, validation::loaders::SwapContext};
use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::{trace, DataIndex, NIL};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    pubkey::Pubkey,
};

use super::shared::get_mut_dynamic_account;

#[cfg(feature = "certora")]
use {
    nondet::nondet, early_panic::early_panic,
    solana_cvt::token::{spl_token_2022_transfer, spl_token_transfer},
    crate::state::{get_helper_seat, update_balance},
    crate::certora::summaries::place_order::place_fully_match_order_with_same_base_and_quote,
    crate::get_withdrawable_base_atoms,
};

use solana_program::program_error::ProgramError;
use crate::state::claimed_seat::ClaimedSeat;
use crate::validation::{MintAccountInfo, Signer, TokenAccountInfo, TokenProgram};

#[derive(BorshDeserialize, BorshSerialize)]
pub struct SwapParams {
    pub in_atoms: u64,
    pub out_atoms: u64,
    pub is_base_in: bool,
    pub is_exact_in: bool,
}

impl SwapParams {
    pub fn new(in_atoms: u64, out_atoms: u64, is_base_in: bool, is_exact_in: bool) -> Self {
        SwapParams {
            in_atoms,
            out_atoms,
            is_base_in,
            is_exact_in,
        }
    }
}

pub(crate) fn process_swap(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let params = SwapParams::try_from_slice(data)?;
    process_swap_core(program_id, accounts, params)
}

#[cfg_attr(all(feature = "certora", not(feature = "certora-test")), early_panic)]
pub(crate) fn process_swap_core(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    params: SwapParams,
) -> ProgramResult {
    let swap_context: SwapContext = SwapContext::load(accounts)?;

    let SwapContext {
        market,
        payer,
        trader_base: trader_base_account,
        trader_quote: trader_quote_account,
        base_vault,
        quote_vault,
        token_program_base,
        token_program_quote,
        base_mint,
        quote_mint,
        global_trade_accounts_opts,
    } = swap_context;

    let market_data: &mut RefMut<&mut [u8]> = &mut market.try_borrow_mut_data()?;
    let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);


    // Claim seat if needed
    let existing_seat_index: DataIndex = dynamic_account.get_trader_index(payer.key);
    if existing_seat_index == NIL {
        dynamic_account.claim_seat(payer.key)?;
    }
    let trader_index: DataIndex = dynamic_account.get_trader_index(payer.key);


    let (initial_base_atoms, initial_quote_atoms) =
        dynamic_account.get_trader_balance(payer.key);

    let SwapParams {
        in_atoms,
        out_atoms,
        is_base_in,
        is_exact_in,
    } = params;

    trace!("swap in_atoms:{in_atoms} out_atoms:{out_atoms} is_base_in:{is_base_in} is_exact_in:{is_exact_in}");

    // this is a virtual credit to ensure matching always proceeds
    // net token transfers will be handled later

    dynamic_account.deposit(payer.key, in_atoms, is_base_in)?;

    let base_atoms: BaseAtoms = if is_exact_in {
        if is_base_in {
            // input=max(base)* output=min(quote)
            BaseAtoms::new(in_atoms)
        } else {
            // input=max(quote)* output=min(base)
            // round down base amount to not cross quote limit
            dynamic_account.impact_base_atoms(
                true, 
                false, 
                QuoteAtoms::new(in_atoms),
                &global_trade_accounts_opts,
            )?
        }
    } else {
        if is_base_in {
            // input=max(base) output=min(quote)*
            // round up base amount to ensure not staying below quote limit
            dynamic_account.impact_base_atoms(
                false, 
                true, 
                QuoteAtoms::new(out_atoms),
                &global_trade_accounts_opts
            )?
        } else {
            // input=max(quote) output=min(base)*
            BaseAtoms::new(out_atoms)
        }
    };

    let price: QuoteAtomsPerBaseAtom = if is_base_in {
        QuoteAtomsPerBaseAtom::MIN
    } else {
        QuoteAtomsPerBaseAtom::MAX
    };
    let last_valid_slot: u32 = NO_EXPIRATION_LAST_VALID_SLOT;
    let order_type: OrderType = OrderType::ImmediateOrCancel;

    trace!("swap in:{in_atoms} out:{out_atoms} base/quote:{is_base_in} in/out:{is_exact_in} base:{base_atoms} price:{price}",);

    let AddOrderToMarketResult {
        base_atoms_traded,
        quote_atoms_traded,
        order_sequence_number,
        order_index,
        ..
    } = place_order(&mut dynamic_account, AddOrderToMarketArgs {
        market: *market.key,
        trader_index,
        num_base_atoms: base_atoms,
        price,
        is_bid: !is_base_in,
        last_valid_slot,
        order_type,
        global_trade_accounts_opts: &global_trade_accounts_opts,
        current_slot: None,
    })?;

    if is_exact_in {
        let out_atoms_traded = if is_base_in {
            quote_atoms_traded.as_u64()
        } else {
            base_atoms_traded.as_u64()
        };
        require!(
            out_atoms <= out_atoms_traded,
            ManifestError::InsufficientOut,
            "Insufficient out atoms returned. Minimum: {} Actual: {}",
            out_atoms,
            out_atoms_traded
        )?;
    } else {
        let in_atoms_traded = if is_base_in {
            base_atoms_traded.as_u64()
        } else {
            quote_atoms_traded.as_u64()
        };
        require!(
            in_atoms >= in_atoms_traded,
            ManifestError::InsufficientOut,
            "Excessive in atoms charged. Maximum: {} Actual: {}",
            in_atoms,
            in_atoms_traded
        )?;
    }

    let (end_base_atoms, end_quote_atoms) = dynamic_account.get_trader_balance(payer.key);
    
    let extra_base_atoms = end_base_atoms.checked_sub(initial_base_atoms)?;
    let extra_quote_atoms = end_quote_atoms.checked_sub(initial_quote_atoms)?;

    // Transfer tokens
    if is_base_in {

        // Trader is depositing base.

        // In order to make the trade, we previously credited the seat with the
        // maximum they could possibly need,
        // The amount to take from them is repaying the full credit, minus the
        // unused amount.
        let initial_credit_base_atoms: BaseAtoms = BaseAtoms::new(in_atoms);

        if *token_program_base.key == spl_token_2022::id() {
            spl_token_2022_transfer_from_trader_to_vault(
                &token_program_base,
                &trader_base_account,
                base_mint,
                dynamic_account.fixed.get_base_mint(),
                &base_vault,
                &payer,
                (initial_credit_base_atoms.checked_sub(extra_base_atoms)?).as_u64(),
                dynamic_account.fixed.get_base_mint_decimals()
            )?;
        } else {
            spl_token_transfer_from_trader_to_vault(
                &token_program_base,
                &trader_base_account,
                &base_vault,
                &payer,
                (initial_credit_base_atoms.checked_sub(extra_base_atoms)?).as_u64()
            )?;
        }

        // Give all but what started there.
        let quote_vault_bump: u8 = dynamic_account.fixed.get_quote_vault_bump();
        if *token_program_quote.key == spl_token_2022::id() {
            spl_token_2022_transfer_from_vault_to_trader(
                &token_program_quote,
                quote_mint,
                dynamic_account.fixed.get_quote_mint(),
                &quote_vault,
                &trader_quote_account,
                extra_quote_atoms.as_u64(),
                dynamic_account.fixed.get_quote_mint_decimals(),
                market.key,
                quote_vault_bump
            )?;
        } else {
            spl_token_transfer_from_vault_to_trader(
                &token_program_quote,
                &quote_vault,
                &trader_quote_account,
                extra_quote_atoms.as_u64(),
                market.key,
                quote_vault_bump,
                dynamic_account.fixed.get_quote_mint()
            )?;
        }
    } else {
        // Trader is depositing quote.

        // In order to make the trade, we previously credited the seat with the
        // maximum they could possibly need.
        // The amount to take from them is repaying the full credit, minus the
        // unused amount.
        let initial_credit_quote_atoms: QuoteAtoms = QuoteAtoms::new(in_atoms);
        if *token_program_quote.key == spl_token_2022::id() {
            spl_token_2022_transfer_from_trader_to_vault(
                &token_program_quote,
                &trader_quote_account,
                quote_mint,
                dynamic_account.fixed.get_quote_mint(),
                &quote_vault,
                &payer,
                (initial_credit_quote_atoms.checked_sub(extra_quote_atoms)?).as_u64(),
                dynamic_account.fixed.get_quote_mint_decimals()
            )?;
        } else {
            spl_token_transfer_from_trader_to_vault(
                &token_program_quote,
                &trader_quote_account,
                &quote_vault,
                &payer,
                (initial_credit_quote_atoms.checked_sub(extra_quote_atoms)?).as_u64()
            )?;
        }

        // Give all but what started there.
        let base_vault_bump: u8 = dynamic_account.fixed.get_base_vault_bump();
        if *token_program_base.key == spl_token_2022::id() {
            spl_token_2022_transfer_from_vault_to_trader(
                &token_program_base,
                base_mint,
                dynamic_account.get_base_mint(),
                &base_vault,
                &trader_base_account,
                extra_base_atoms.as_u64(),
                dynamic_account.fixed.get_base_mint_decimals(),
                market.key,
                base_vault_bump
            )?;
        } else {
            spl_token_transfer_from_vault_to_trader(
                &token_program_base,
                &base_vault,
                &trader_base_account,
                extra_base_atoms.as_u64(),
                market.key,
                base_vault_bump,
                dynamic_account.get_base_mint()
            )?;
        }
    }

    if existing_seat_index == NIL {
        dynamic_account.release_seat(payer.key)?;
    } else {
        // Withdraw in case there already was a seat so it doesnt mess with their
        // balances. Need to withdraw base and quote in case the order wasnt fully
        // filled.
        dynamic_account.withdraw(payer.key, extra_base_atoms.as_u64(), true)?;
        dynamic_account.withdraw(payer.key, extra_quote_atoms.as_u64(), false)?;
    }

    emit_stack(PlaceOrderLog {
        market: *market.key,
        trader: *payer.key,
        base_atoms,
        price,
        order_type,
        is_bid: (!is_base_in).into(),
        _padding: [0; 6],
        order_sequence_number,
        order_index,
        last_valid_slot,
    })?;

    Ok(())
}

#[cfg(not(feature="certora"))]
fn place_order(dynamic_account: &mut MarketRefMut, args: AddOrderToMarketArgs) -> Result<AddOrderToMarketResult, ProgramError> {
   dynamic_account.place_order(args)
}

#[cfg(feature="certora")]
fn place_order(market: &mut MarketRefMut, args: AddOrderToMarketArgs) -> Result<AddOrderToMarketResult, ProgramError> {
    place_fully_match_order_with_same_base_and_quote(market, args)
}


/** Transfer from base (quote) trader to base (quote) vault using SPL Token **/
#[cfg(not(feature = "certora"))]
fn spl_token_transfer_from_trader_to_vault<'a, 'info>(
    token_program: &TokenProgram<'a,'info>,
    trader_account: &TokenAccountInfo<'a,'info>,
    vault: &TokenAccountInfo<'a,'info>,
    payer: &Signer<'a,'info>,
    amount: u64
) -> ProgramResult {
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            trader_account.key,
            vault.key,
            payer.key,
            &[],
            amount,
        )?,
        &[
            token_program.as_ref().clone(),
            trader_account.as_ref().clone(),
            vault.as_ref().clone(),
            payer.as_ref().clone(),
        ],
    )
}
#[cfg(feature = "certora")]
/** (Summary) Transfer from base (quote) trader to base (quote) vault using SPL Token **/
fn spl_token_transfer_from_trader_to_vault<'a, 'info>(
    _token_program: &TokenProgram<'a,'info>,
    trader_account: &TokenAccountInfo<'a,'info>,
    vault: &TokenAccountInfo<'a,'info>,
    payer: &Signer<'a,'info>,
    amount: u64
) -> ProgramResult {
    spl_token_transfer(trader_account.info, vault.info, payer.info, amount)
}

/** Transfer from base (quote) trader to base (quote) vault using SPL Token 2022 **/
#[cfg(not(feature = "certora"))]
fn spl_token_2022_transfer_from_trader_to_vault<'a, 'info>(
    token_program: &TokenProgram<'a,'info>,
    trader_account: &TokenAccountInfo<'a,'info>,
    mint: Option<MintAccountInfo<'a,'info>>,
    mint_pubkey: &Pubkey,
    vault: &TokenAccountInfo<'a,'info>,
    payer: &Signer<'a,'info>,
    amount: u64,
    decimals: u8
) -> ProgramResult {
    invoke(
        &spl_token_2022::instruction::transfer_checked(
        token_program.key,
        trader_account.key,
        mint_pubkey,
        vault.key,
        payer.key,
        &[],
        amount,
        decimals
    )?,
           &[
               token_program.as_ref().clone(),
               trader_account.as_ref().clone(),
               vault.as_ref().clone(),
               mint.unwrap().as_ref().clone(),
               payer.as_ref().clone()
           ])
}

#[cfg(feature = "certora")]
/** (Summary) Transfer from base (quote) trader to base (quote) vault using SPL Token 2022 **/
fn spl_token_2022_transfer_from_trader_to_vault<'a, 'info>(
    _token_program: &TokenProgram<'a,'info>,
    trader_account: &TokenAccountInfo<'a,'info>,
    _mint: Option<MintAccountInfo<'a,'info>>,
    _mint_pubkey: &Pubkey,
    vault: &TokenAccountInfo<'a,'info>,
    payer: &Signer<'a,'info>,
    amount: u64,
    _decimals: u8
) -> ProgramResult {
    spl_token_2022_transfer(trader_account.info, vault.info, payer.info, amount)
}

/** Transfer from base (quote) vault to base (quote) trader using SPL Token **/
#[cfg(not(feature = "certora"))]
fn spl_token_transfer_from_vault_to_trader<'a, 'info>(
    token_program: &TokenProgram<'a,'info>,
    vault: &TokenAccountInfo<'a, 'info>,
    trader_account: &TokenAccountInfo<'a,'info>,
    amount: u64,
    market_key: &Pubkey,
    vault_bump:u8,
    mint_pubkey: &Pubkey
) -> ProgramResult {
    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            vault.key,
            trader_account.key,
            vault.key,
            &[],
            amount,
        )?,
        &[
            token_program.as_ref().clone(),
            vault.as_ref().clone(),
            trader_account.as_ref().clone(),
        ],
        market_vault_seeds_with_bump!(
                    market_key,
                    mint_pubkey,
                    vault_bump
                ),
    )
}

#[cfg(feature = "certora")]
/** (Summary) Transfer from base (quote) vault to base (quote) trader using SPL Token **/
fn spl_token_transfer_from_vault_to_trader<'a, 'info>(
    _token_program: &TokenProgram<'a,'info>,
    vault: &TokenAccountInfo<'a, 'info>,
    trader_account: &TokenAccountInfo<'a,'info>,
    amount: u64,
    _market_key: &Pubkey,
    _vault_bump:u8,
    _mint_pubkey: &Pubkey
) -> ProgramResult {
    spl_token_transfer(vault.info, trader_account.info, vault.info, amount)
}

/** Transfer from base (quote) vault to base (quote) trader using SPL Token 2022 **/
#[cfg(not(feature = "certora"))]
fn spl_token_2022_transfer_from_vault_to_trader<'a, 'info>(
    token_program: &TokenProgram<'a,'info>,
    mint: Option<MintAccountInfo<'a,'info>>,
    mint_pubkey: &Pubkey,
    vault: &TokenAccountInfo<'a, 'info>,
    trader_account: &TokenAccountInfo<'a,'info>,
    amount: u64,
    decimals: u8,
    market_key: &Pubkey,
    vault_bump:u8
) -> ProgramResult {
    invoke_signed(
        &spl_token_2022::instruction::transfer_checked(
            token_program.key,
            vault.key,
            mint_pubkey,
            trader_account.key,
            vault.key,
            &[],
            amount,
            decimals,
        )?,
        &[
            token_program.as_ref().clone(),
            vault.as_ref().clone(),
            mint.unwrap().as_ref().clone(),
            trader_account.as_ref().clone(),
        ],
        market_vault_seeds_with_bump!(
                    market_key,
                    mint_pubkey,
                    vault_bump
                ),
    )
}

#[cfg(feature = "certora")]
/** (Summary) Transfer from base (quote) vault to base (quote) trader using SPL Token 2022 **/
fn spl_token_2022_transfer_from_vault_to_trader<'a, 'info>(
    _token_program: &TokenProgram<'a,'info>,
    _mint: Option<MintAccountInfo<'a,'info>>,
    _mint_pubkey: &Pubkey,
    vault: &TokenAccountInfo<'a, 'info>,
    trader_account: &TokenAccountInfo<'a,'info>,
    amount: u64,
    _decimals: u8,
    _market_key: &Pubkey,
    _vault_bump:u8
) -> ProgramResult {
    spl_token_2022_transfer(vault.info, trader_account.info, vault.info, amount)
}

