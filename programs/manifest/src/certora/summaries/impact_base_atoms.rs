use solana_program::program_error::ProgramError;
use crate::quantities::{BaseAtoms, QuoteAtoms};
use crate::state::{DerefOrBorrow, DynamicAccount, MarketFixed};
use crate::validation::loaders::GlobalTradeAccounts;

use {
    nondet::*,
};

/// Summary for impact_base_atoms
pub fn impact_base_atoms<Fixed: DerefOrBorrow<MarketFixed>, Dynamic: DerefOrBorrow<[u8]>>(
        _dynamic_account: &DynamicAccount<Fixed, Dynamic>,
        _is_bid: bool,
        _round_up: bool,
        _limit_quote_atoms: QuoteAtoms,
        _global_trade_accounts_opts: &[Option<GlobalTradeAccounts>; 2],
 ) -> Result<BaseAtoms, ProgramError> {
        Ok(nondet())
}
