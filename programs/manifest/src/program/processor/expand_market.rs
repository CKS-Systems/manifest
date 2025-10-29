use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::{
    program::get_dynamic_account, state::MarketRef, validation::loaders::ExpandMarketContext,
};
use std::cell::Ref;

use super::expand_market;

pub(crate) fn process_expand_market(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let expand_market_context: ExpandMarketContext = ExpandMarketContext::load(accounts)?;
    let ExpandMarketContext { market, payer, .. } = expand_market_context;

    let has_two_free_blocks: bool = {
        let market_data: Ref<'_, &mut [u8]> = market.try_borrow_data()?;
        let dynamic_account: MarketRef = get_dynamic_account(&market_data);
        dynamic_account.has_two_free_blocks()
    };

    if !has_two_free_blocks {
        expand_market(&payer, &market)
    } else {
        Ok(())
    }
}
