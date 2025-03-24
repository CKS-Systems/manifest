use std::cell::RefMut;

use crate::{
    logs::{emit_stack, ClaimSeatLog},
    state::{MarketFixed, MarketRefMut},
    validation::{loaders::ClaimSeatContext, ManifestAccountInfo, Signer},
};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use super::shared::{expand_market_if_needed, get_mut_dynamic_account};

#[cfg(feature = "certora")]
use early_panic::early_panic;

#[cfg_attr(all(feature = "certora", not(feature = "certora-test")), early_panic)]
pub(crate) fn process_claim_seat(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let claim_seat_context: ClaimSeatContext = ClaimSeatContext::load(accounts)?;
    let ClaimSeatContext { market, payer, .. } = claim_seat_context;

    process_claim_seat_internal(&market, &payer)?;

    // Leave a free block on the market
    expand_market_if_needed(&payer, &market)?;

    Ok(())
}

#[cfg_attr(all(feature = "certora", not(feature = "certora-test")), early_panic)]
pub(crate) fn process_claim_seat_internal<'a, 'info>(
    market: &ManifestAccountInfo<'a, 'info, MarketFixed>,
    payer: &Signer<'a, 'info>,
) -> ProgramResult {
    let market_data: &mut RefMut<&mut [u8]> = &mut market.try_borrow_mut_data()?;
    let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
    dynamic_account.claim_seat(payer.key)?;

    emit_stack(ClaimSeatLog {
        market: *market.key,
        trader: *payer.key,
    })?;

    Ok(())
}
