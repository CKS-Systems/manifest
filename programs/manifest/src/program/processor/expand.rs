use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::validation::loaders::ExpandContext;

use super::shared::expand_market_if_needed;

pub(crate) fn process_expand(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let expand_context: ExpandContext = ExpandContext::load(accounts)?;
    let ExpandContext {
        market,
        payer,
        system_program,
    } = expand_context;

    expand_market_if_needed(&payer, &market, &system_program)?;

    Ok(())
}
