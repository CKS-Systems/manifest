use std::cell::RefMut;

use hypertree::{trace, NIL};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::{
    logs::{emit_stack, GlobalClaimSeatLog},
    program::{
        claim_seat::process_claim_seat_internal, expand_global, expand_market_if_needed,
        get_mut_dynamic_account,
    },
    state::{GlobalRefMut, MarketRefMut},
    validation::loaders::GlobalClaimSeatContext,
};

pub(crate) fn process_global_claim_seat(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    trace!("process_global_claim_seat accs={accounts:?}");
    let global_claim_seat_context: GlobalClaimSeatContext = GlobalClaimSeatContext::load(accounts)?;

    let GlobalClaimSeatContext {
        payer,
        global,
        system_program,
        market,
    } = global_claim_seat_context;

    expand_global(&payer, &global, &system_program)?;

    let global_data: &mut RefMut<&mut [u8]> = &mut global.try_borrow_mut_data()?;
    let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);
    global_dynamic_account.claim_seat_on_market(payer.key, market.key)?;

    // Does not need a CPI because the payer is the owner of that seat too.
    let already_has_seat_on_market: bool = {
        let market_data: &mut RefMut<&mut [u8]> = &mut market.try_borrow_mut_data()?;
        let mut market_dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
        market_dynamic_account.get_trader_index(&payer.key) != NIL
    };

    if !already_has_seat_on_market {
        process_claim_seat_internal(&market, &payer)?;
        // Expand the market after claiming a seat on it.
        expand_market_if_needed(&payer, &market, &system_program)?;
    }

    emit_stack(GlobalClaimSeatLog {
        global: *global.key,
        market: *market.key,
        trader: *payer.key,
    })?;

    Ok(())
}
