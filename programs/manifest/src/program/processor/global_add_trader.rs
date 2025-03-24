use std::cell::RefMut;

use hypertree::trace;
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::{
    logs::{emit_stack, GlobalAddTraderLog},
    program::{expand_global, get_mut_dynamic_account},
    state::GlobalRefMut,
    validation::loaders::GlobalAddTraderContext,
};

pub(crate) fn process_global_add_trader(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    trace!("process_global_add_trader accs={accounts:?}");
    let global_add_trader_context: GlobalAddTraderContext = GlobalAddTraderContext::load(accounts)?;

    let GlobalAddTraderContext { payer, global, .. } = global_add_trader_context;

    // Needs a spot for this trader on the global account.
    expand_global(&payer, &global)?;

    let global_data: &mut RefMut<&mut [u8]> = &mut global.try_borrow_mut_data()?;
    let mut global_dynamic_account: GlobalRefMut = get_mut_dynamic_account(global_data);

    global_dynamic_account.add_trader(payer.key)?;

    emit_stack(GlobalAddTraderLog {
        global: *global.key,
        trader: *payer.key,
    })?;

    Ok(())
}
