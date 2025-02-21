use pinocchio::{account_info::AccountInfo, ProgramResult};

use crate::validation::loaders::ExpandMarketContext;

use super::expand_market;

pub(crate) fn process_expand_market(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let expand_market_context: ExpandMarketContext = ExpandMarketContext::load(accounts)?;
    let ExpandMarketContext {
        market,
        payer,
        system_program,
    } = expand_market_context;

    expand_market(&payer, &market, &system_program)
}
