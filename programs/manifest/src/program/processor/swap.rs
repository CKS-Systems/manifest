use std::cell::RefMut;

use crate::{
    logs::{emit_stack, PlaceOrderLog},
    market_vault_seeds_with_bump,
    program::ManifestError,
    quantities::{BaseAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    require,
    state::{
        AddOrderToMarketArgs, AddOrderToMarketResult, MarketRefMut, OrderType,
        NO_EXPIRATION_LAST_VALID_SLOT,
    },
    validation::loaders::SwapContext,
};
use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::{trace, DataIndex, NIL};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    pubkey::Pubkey,
};

use super::shared::get_mut_dynamic_account;

#[derive(BorshDeserialize, BorshSerialize)]
pub struct SwapParams {
    in_atoms: u64,
    out_atoms: u64,
    is_base_in: bool,
    // Exact in is a technical term that doesnt actually mean exact. It is
    // desired. If not that much can be fulfilled, less will be allowed assuming
    // the min_out/max_in is satisfied.
    is_exact_in: bool,
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
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
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

    let (initial_base_atoms, initial_quote_atoms) = dynamic_account.get_trader_balance(payer.key);

    let SwapParams {
        in_atoms,
        out_atoms,
        is_base_in,
        is_exact_in,
    } = SwapParams::try_from_slice(data)?;

    trace!("swap in_atoms:{in_atoms} out_atoms:{out_atoms} is_base_in:{is_base_in} is_exact_in:{is_exact_in}");

    // this is a virtual credit to ensure matching always proceeds
    // net token transfers will be handled later
    dynamic_account.deposit(payer.key, in_atoms, is_base_in)?;

    // 4 cases:
    // 1. Exact in base. Simplest case, just use the base atoms given.
    // 2. Exact in quote. Search the asks for the number of base atoms in bids to match.
    // 3. Exact out quote. Search the bids for the number of base atoms needed to match to get the right quote out.
    // 4. Exact out base. Use the number of out atoms as the number of atoms to place_order against.
    let base_atoms: BaseAtoms = if is_exact_in {
        if is_base_in {
            // input=desired max(base) output=checked min(quote)
            BaseAtoms::new(in_atoms)
        } else {
            // input=desired max(quote) output=checked min(base)
            dynamic_account.impact_base_atoms(true, QuoteAtoms::new(in_atoms))?
        }
    } else {
        if is_base_in {
            // input=checked max(base) output=desired min(quote)
            dynamic_account.impact_base_atoms(false, QuoteAtoms::new(out_atoms))?
        } else {
            // input=checked max(quote) output=desired min(base)
            BaseAtoms::new(out_atoms)
        }
    };

    // Note that in the case of fully exhausting the book, exact in/out will not
    // be respected. It should be treated as a desired in/out. This pushes the
    // burden of checking the results onto the caller program.

    // Example case is exact quote in. User wants exact quote in of 1_000_000
    // and min base out of 1_000. Suppose they fully exhaust the book and get
    // out 2_000 but that is not enough to fully use the entire 1_000_000. In
    // this case the ix will succeed.

    // Another interesting case is exact quote out. Suppose the user is doing
    // exact quote out 1_000_000 with max_base_in of 1_000. If it fully exhausts
    // the book without using the entire max_base_in and that is still not
    // enough for the exact quote amount, the transaction will still succeed.

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
    } = dynamic_account.place_order(AddOrderToMarketArgs {
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
        let out_atoms_traded: u64 = if is_base_in {
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
    let extra_base_atoms: BaseAtoms = end_base_atoms.checked_sub(initial_base_atoms)?;
    let extra_quote_atoms: QuoteAtoms = end_quote_atoms.checked_sub(initial_quote_atoms)?;

    // Transfer tokens
    if is_base_in {
        // Trader is depositing base.

        // In order to make the trade, we previously credited the seat with the
        // maximum they could possibly need,
        // The amount to take from them is repaying the full credit, minus the
        // unused amount.
        let initial_credit_base_atoms: BaseAtoms = BaseAtoms::new(in_atoms);

        if *token_program_base.key == spl_token_2022::id() {
            invoke(
                &spl_token_2022::instruction::transfer_checked(
                    token_program_base.key,
                    trader_base_account.key,
                    dynamic_account.fixed.get_base_mint(),
                    base_vault.key,
                    payer.key,
                    &[],
                    (initial_credit_base_atoms.checked_sub(extra_base_atoms)?).as_u64(),
                    dynamic_account.fixed.get_base_mint_decimals(),
                )?,
                &[
                    token_program_base.as_ref().clone(),
                    trader_base_account.as_ref().clone(),
                    base_vault.as_ref().clone(),
                    base_mint.unwrap().as_ref().clone(),
                    payer.as_ref().clone(),
                ],
            )?;
        } else {
            invoke(
                &spl_token::instruction::transfer(
                    token_program_base.key,
                    trader_base_account.key,
                    base_vault.key,
                    payer.key,
                    &[],
                    (initial_credit_base_atoms.checked_sub(extra_base_atoms)?).as_u64(),
                )?,
                &[
                    token_program_base.as_ref().clone(),
                    trader_base_account.as_ref().clone(),
                    base_vault.as_ref().clone(),
                    payer.as_ref().clone(),
                ],
            )?;
        }

        // Give all but what started there.
        let quote_vault_bump: u8 = dynamic_account.fixed.get_quote_vault_bump();
        if *token_program_quote.key == spl_token_2022::id() {
            invoke_signed(
                &spl_token_2022::instruction::transfer_checked(
                    token_program_quote.key,
                    quote_vault.key,
                    dynamic_account.fixed.get_quote_mint(),
                    trader_quote_account.key,
                    quote_vault.key,
                    &[],
                    extra_quote_atoms.as_u64(),
                    dynamic_account.fixed.get_quote_mint_decimals(),
                )?,
                &[
                    token_program_quote.as_ref().clone(),
                    quote_vault.as_ref().clone(),
                    quote_mint.unwrap().as_ref().clone(),
                    trader_quote_account.as_ref().clone(),
                ],
                market_vault_seeds_with_bump!(
                    market.key,
                    dynamic_account.get_quote_mint(),
                    quote_vault_bump
                ),
            )?;
        } else {
            invoke_signed(
                &spl_token::instruction::transfer(
                    token_program_quote.key,
                    quote_vault.key,
                    trader_quote_account.key,
                    quote_vault.key,
                    &[],
                    extra_quote_atoms.as_u64(),
                )?,
                &[
                    token_program_quote.as_ref().clone(),
                    quote_vault.as_ref().clone(),
                    trader_quote_account.as_ref().clone(),
                ],
                market_vault_seeds_with_bump!(
                    market.key,
                    dynamic_account.get_quote_mint(),
                    quote_vault_bump
                ),
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
            invoke(
                &spl_token_2022::instruction::transfer_checked(
                    token_program_quote.key,
                    trader_quote_account.key,
                    dynamic_account.fixed.get_quote_mint(),
                    quote_vault.key,
                    payer.key,
                    &[],
                    (initial_credit_quote_atoms.checked_sub(extra_quote_atoms)?).as_u64(),
                    dynamic_account.fixed.get_quote_mint_decimals(),
                )?,
                &[
                    token_program_quote.as_ref().clone(),
                    trader_quote_account.as_ref().clone(),
                    quote_mint.unwrap().as_ref().clone(),
                    quote_vault.as_ref().clone(),
                    payer.as_ref().clone(),
                ],
            )?;
        } else {
            invoke(
                &spl_token::instruction::transfer(
                    token_program_quote.key,
                    trader_quote_account.key,
                    quote_vault.key,
                    payer.key,
                    &[],
                    (initial_credit_quote_atoms.checked_sub(extra_quote_atoms)?).as_u64(),
                )?,
                &[
                    token_program_quote.as_ref().clone(),
                    trader_quote_account.as_ref().clone(),
                    quote_vault.as_ref().clone(),
                    payer.as_ref().clone(),
                ],
            )?;
        }

        // Give all but what started there.
        let base_vault_bump: u8 = dynamic_account.fixed.get_base_vault_bump();
        if *token_program_base.key == spl_token_2022::id() {
            invoke_signed(
                &spl_token_2022::instruction::transfer_checked(
                    token_program_base.key,
                    base_vault.key,
                    dynamic_account.get_base_mint(),
                    trader_base_account.key,
                    base_vault.key,
                    &[],
                    extra_base_atoms.as_u64(),
                    dynamic_account.fixed.get_base_mint_decimals(),
                )?,
                &[
                    token_program_base.as_ref().clone(),
                    base_vault.as_ref().clone(),
                    base_mint.unwrap().as_ref().clone(),
                    trader_base_account.as_ref().clone(),
                ],
                market_vault_seeds_with_bump!(
                    market.key,
                    dynamic_account.get_base_mint(),
                    base_vault_bump
                ),
            )?;
        } else {
            invoke_signed(
                &spl_token::instruction::transfer(
                    token_program_base.key,
                    base_vault.key,
                    trader_base_account.key,
                    base_vault.key,
                    &[],
                    extra_base_atoms.as_u64(),
                )?,
                &[
                    token_program_base.as_ref().clone(),
                    base_vault.as_ref().clone(),
                    trader_base_account.as_ref().clone(),
                ],
                market_vault_seeds_with_bump!(
                    market.key,
                    dynamic_account.get_base_mint(),
                    base_vault_bump
                ),
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
