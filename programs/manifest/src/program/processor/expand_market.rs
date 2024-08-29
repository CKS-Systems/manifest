use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::validation::loaders::ExpandMarketContext;

use super::shared::expand_market_if_needed;

pub(crate) fn process_expand_market(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let expand_market_context: ExpandMarketContext = ExpandMarketContext::load(accounts)?;
    let ExpandMarketContext {
        market,
        payer,
        system_program,
    } = expand_market_context;

    expand_market_if_needed(&payer, &market, &system_program)?;

    Ok(())
}
