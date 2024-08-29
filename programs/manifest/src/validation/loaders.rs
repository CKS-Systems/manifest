use std::{cell::Ref, slice::Iter};

use hypertree::{get_helper, trace};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    program_error::ProgramError,
    pubkey::Pubkey,
    system_program,
};

use crate::{
    program::{assert_with_msg, ManifestError},
    state::{GlobalFixed, MarketFixed},
    validation::{EmptyAccount, MintAccountInfo, Program, Signer, TokenAccountInfo},
};

use super::{get_vault_address, ManifestAccountInfo, TokenProgram};

/// CreateMarket account infos
pub(crate) struct CreateMarketContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub market: ManifestAccountInfo<'a, 'info, MarketFixed>,
    pub base_mint: MintAccountInfo<'a, 'info>,
    pub quote_mint: MintAccountInfo<'a, 'info>,
    pub base_vault: EmptyAccount<'a, 'info>,
    pub quote_vault: EmptyAccount<'a, 'info>,
    pub system_program: Program<'a, 'info>,
    pub token_program: TokenProgram<'a, 'info>,
    pub token_program_22: TokenProgram<'a, 'info>,
}

impl<'a, 'info> CreateMarketContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new_payer(next_account_info(account_iter)?)?;
        let market: ManifestAccountInfo<MarketFixed> =
            ManifestAccountInfo::<MarketFixed>::new_init(next_account_info(account_iter)?)?;
        let system_program: Program =
            Program::new(next_account_info(account_iter)?, &system_program::id())?;
        let base_mint: MintAccountInfo = MintAccountInfo::new(next_account_info(account_iter)?)?;
        let quote_mint: MintAccountInfo = MintAccountInfo::new(next_account_info(account_iter)?)?;
        let base_vault: EmptyAccount = EmptyAccount::new(next_account_info(account_iter)?)?;
        let quote_vault: EmptyAccount = EmptyAccount::new(next_account_info(account_iter)?)?;

        let (expected_base_vault, _base_vault_bump) =
            get_vault_address(market.key, base_mint.info.key);
        let (expected_quote_vault, _quote_vault_bump) =
            get_vault_address(market.key, quote_mint.info.key);

        assert_with_msg(
            expected_base_vault == *base_vault.info.key,
            ManifestError::IncorrectAccount,
            "Incorrect base vault account",
        )?;
        assert_with_msg(
            expected_quote_vault == *quote_vault.info.key,
            ManifestError::IncorrectAccount,
            "Incorrect quote vault account",
        )?;
        let token_program: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
        let token_program_22: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
        Ok(Self {
            payer,
            market,
            base_vault,
            quote_vault,
            base_mint,
            quote_mint,
            token_program,
            token_program_22,
            system_program,
        })
    }
}

/// ClaimSeat account infos
pub(crate) struct ClaimSeatContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub market: ManifestAccountInfo<'a, 'info, MarketFixed>,
    pub system_program: Program<'a, 'info>,
}

impl<'a, 'info> ClaimSeatContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new_payer(next_account_info(account_iter)?)?;
        let market: ManifestAccountInfo<MarketFixed> =
            ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
        let system_program: Program =
            Program::new(next_account_info(account_iter)?, &system_program::id())?;
        Ok(Self {
            payer,
            market,
            system_program,
        })
    }
}

/// ExpandMarketContext account infos
pub(crate) struct ExpandMarketContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub market: ManifestAccountInfo<'a, 'info, MarketFixed>,
    pub system_program: Program<'a, 'info>,
}

impl<'a, 'info> ExpandMarketContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new_payer(next_account_info(account_iter)?)?;
        let market: ManifestAccountInfo<MarketFixed> =
            ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
        let system_program: Program =
            Program::new(next_account_info(account_iter)?, &system_program::id())?;
        Ok(Self {
            payer,
            market,
            system_program,
        })
    }
}

/// Deposit into a market account infos
pub(crate) struct DepositContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub market: ManifestAccountInfo<'a, 'info, MarketFixed>,
    pub trader_token: TokenAccountInfo<'a, 'info>,
    pub vault: TokenAccountInfo<'a, 'info>,
    pub token_program: TokenProgram<'a, 'info>,
    pub mint: MintAccountInfo<'a, 'info>,
}

impl<'a, 'info> DepositContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new(next_account_info(account_iter)?)?;
        let market: ManifestAccountInfo<MarketFixed> =
            ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;

        let market_fixed: Ref<MarketFixed> = market.get_fixed()?;
        let base_mint: &Pubkey = market_fixed.get_base_mint();
        let quote_mint: &Pubkey = market_fixed.get_quote_mint();

        let token_account_info: &AccountInfo<'info> = next_account_info(account_iter)?;

        // Infer the mint key from the token account.
        let (mint, expected_vault_address) =
            if &token_account_info.try_borrow_data()?[0..32] == base_mint.as_ref() {
                (base_mint, market_fixed.get_base_vault())
            } else if &token_account_info.try_borrow_data()?[0..32] == quote_mint.as_ref() {
                (quote_mint, market_fixed.get_quote_vault())
            } else {
                return Err(ManifestError::InvalidWithdrawAccounts.into());
            };

        trace!("trader token account {:?}", token_account_info.key);
        let trader_token: TokenAccountInfo =
            TokenAccountInfo::new_with_owner(token_account_info, mint, payer.key)?;

        trace!("vault token account {:?}", expected_vault_address);
        let vault: TokenAccountInfo = TokenAccountInfo::new_with_owner_and_key(
            next_account_info(account_iter)?,
            mint,
            &expected_vault_address,
            &expected_vault_address,
        )?;

        let token_program: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
        let mint: MintAccountInfo = MintAccountInfo::new(next_account_info(account_iter)?)?;

        // Drop the market ref so it can be passed through the return.
        drop(market_fixed);
        Ok(Self {
            payer,
            market,
            trader_token,
            vault,
            token_program,
            mint,
        })
    }
}

/// Withdraw account infos
pub(crate) struct WithdrawContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub market: ManifestAccountInfo<'a, 'info, MarketFixed>,
    pub trader_token: TokenAccountInfo<'a, 'info>,
    pub vault: TokenAccountInfo<'a, 'info>,
    pub token_program: TokenProgram<'a, 'info>,
    pub mint: MintAccountInfo<'a, 'info>,
}

impl<'a, 'info> WithdrawContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new(next_account_info(account_iter)?)?;
        let market: ManifestAccountInfo<MarketFixed> =
            ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;

        let market_fixed: Ref<MarketFixed> = market.get_fixed()?;
        let base_mint: &Pubkey = market_fixed.get_base_mint();
        let quote_mint: &Pubkey = market_fixed.get_quote_mint();

        let token_account_info: &AccountInfo<'info> = next_account_info(account_iter)?;

        let (mint, expected_vault_address) =
            if &token_account_info.try_borrow_data()?[0..32] == base_mint.as_ref() {
                (base_mint, market_fixed.get_base_vault())
            } else if &token_account_info.try_borrow_data()?[0..32] == quote_mint.as_ref() {
                (quote_mint, market_fixed.get_quote_vault())
            } else {
                return Err(ManifestError::InvalidWithdrawAccounts.into());
            };

        let trader_token: TokenAccountInfo =
            TokenAccountInfo::new_with_owner(token_account_info, mint, payer.key)?;
        let vault: TokenAccountInfo = TokenAccountInfo::new_with_owner_and_key(
            next_account_info(account_iter)?,
            mint,
            &expected_vault_address,
            &expected_vault_address,
        )?;

        let token_program: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
        let mint: MintAccountInfo = MintAccountInfo::new(next_account_info(account_iter)?)?;

        // Drop the market ref so it can be passed through the return.
        drop(market_fixed);
        Ok(Self {
            payer,
            market,
            trader_token,
            vault,
            token_program,
            mint,
        })
    }
}

/// Swap account infos
pub(crate) struct SwapContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub market: ManifestAccountInfo<'a, 'info, MarketFixed>,
    pub trader_base: TokenAccountInfo<'a, 'info>,
    pub trader_quote: TokenAccountInfo<'a, 'info>,
    pub base_vault: TokenAccountInfo<'a, 'info>,
    pub quote_vault: TokenAccountInfo<'a, 'info>,
    pub token_program_base: TokenProgram<'a, 'info>,
    pub token_program_quote: TokenProgram<'a, 'info>,
    pub base_mint: Option<MintAccountInfo<'a, 'info>>,
    pub quote_mint: Option<MintAccountInfo<'a, 'info>>,

    // One for each side. First is base, then is quote.
    pub global_trade_accounts_opts: [Option<GlobalTradeAccounts<'a, 'info>>; 2],
}

impl<'a, 'info> SwapContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new(next_account_info(account_iter)?)?;
        let market: ManifestAccountInfo<MarketFixed> =
            ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;

        let market_fixed: Ref<MarketFixed> = market.get_fixed()?;
        let base_mint_key: Pubkey = *market_fixed.get_base_mint();
        let quote_mint_key: Pubkey = *market_fixed.get_quote_mint();

        let trader_base: TokenAccountInfo = TokenAccountInfo::new_with_owner(
            next_account_info(account_iter)?,
            &base_mint_key,
            payer.key,
        )?;
        let trader_quote: TokenAccountInfo = TokenAccountInfo::new_with_owner(
            next_account_info(account_iter)?,
            &quote_mint_key,
            payer.key,
        )?;
        let base_vault_address: &Pubkey = market_fixed.get_base_vault();
        let quote_vault_address: &Pubkey = market_fixed.get_quote_vault();

        let base_vault: TokenAccountInfo = TokenAccountInfo::new_with_owner_and_key(
            next_account_info(account_iter)?,
            &base_mint_key,
            &base_vault_address,
            &base_vault_address,
        )?;
        let quote_vault: TokenAccountInfo = TokenAccountInfo::new_with_owner_and_key(
            next_account_info(account_iter)?,
            &quote_mint_key,
            &quote_vault_address,
            &quote_vault_address,
        )?;
        drop(market_fixed);

        let token_program_base: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
        let mut base_mint: Option<MintAccountInfo> = None;

        let mut current_account_info_or: Result<&AccountInfo<'info>, ProgramError> =
            next_account_info(account_iter);

        // Possibly includes base mint.
        if current_account_info_or
            .as_ref()
            .is_ok_and(|f| *f.owner == spl_token::id() || *f.owner == spl_token_2022::id())
        {
            let current_account_info: &AccountInfo<'info> = current_account_info_or?;
            base_mint = Some(MintAccountInfo::new(current_account_info)?);
            current_account_info_or = next_account_info(account_iter);
        }

        // Clone is not a problem since we are deserializing token program
        // anyways, so at most this is one more.
        let mut token_program_quote: TokenProgram = token_program_base.clone();
        let mut quote_mint: Option<MintAccountInfo> = None;
        let mut global_trade_accounts_opts: [Option<GlobalTradeAccounts<'a, 'info>>; 2] =
            [None, None];

        // Possibly includes quote token program.
        if current_account_info_or
            .as_ref()
            .is_ok_and(|f| *f.key == spl_token::id() || *f.key == spl_token_2022::id())
        {
            let current_account_info: &AccountInfo<'info> = current_account_info_or?;
            token_program_quote = TokenProgram::new(current_account_info)?;
            current_account_info_or = next_account_info(account_iter);
        }
        // Possibly includes quote mint if the quote token program was token22.
        if current_account_info_or
            .as_ref()
            .is_ok_and(|f| *f.owner == spl_token::id() || *f.owner == spl_token_2022::id())
        {
            let current_account_info: &AccountInfo<'info> = current_account_info_or?;
            quote_mint = Some(MintAccountInfo::new(current_account_info)?);
            current_account_info_or = next_account_info(account_iter);
        }

        if current_account_info_or.is_ok() {
            let global: ManifestAccountInfo<'a, 'info, GlobalFixed> =
                ManifestAccountInfo::<GlobalFixed>::new(current_account_info_or?)?;
            let global_data: Ref<&mut [u8]> = global.data.borrow();
            let global_fixed: &GlobalFixed = get_helper::<GlobalFixed>(&global_data, 0_u32);
            let global_mint_key: &Pubkey = global_fixed.get_mint();
            let expected_global_vault_address: &Pubkey = global_fixed.get_vault();

            let global_vault: TokenAccountInfo<'a, 'info> =
                TokenAccountInfo::new_with_owner_and_key(
                    next_account_info(account_iter)?,
                    global_mint_key,
                    &expected_global_vault_address,
                    &expected_global_vault_address,
                )?;

            let index: usize = if *global_mint_key == base_mint_key {
                0
            } else {
                assert_with_msg(
                    quote_mint_key == *global_mint_key,
                    ManifestError::MissingGlobal,
                    "Unexpected global accounts",
                )?;
                1
            };

            drop(global_data);
            global_trade_accounts_opts[index] = Some(GlobalTradeAccounts {
                mint: if index == 0 {
                    base_mint.clone()
                } else {
                    quote_mint.clone()
                },
                global,
                global_vault,
                market_vault: if index == 0 {
                    base_vault.clone()
                } else {
                    quote_vault.clone()
                },
                token_program: if index == 0 {
                    token_program_base.clone()
                } else {
                    token_program_quote.clone()
                },
                trader: *payer.info.key,
                market: *market.info.key,
            });
        }

        Ok(Self {
            payer,
            market,
            trader_base,
            trader_quote,
            base_vault,
            quote_vault,
            token_program_base,
            token_program_quote,
            base_mint,
            quote_mint,
            global_trade_accounts_opts,
        })
    }
}

/// Accounts needed to make a global trade. Scope is beyond just crate so
/// clients can place orders on markets in testing.
pub struct GlobalTradeAccounts<'a, 'info> {
    /// Required if this is a token22 token.
    pub mint: Option<MintAccountInfo<'a, 'info>>,
    pub global: ManifestAccountInfo<'a, 'info, GlobalFixed>,
    pub global_vault: TokenAccountInfo<'a, 'info>,
    pub market_vault: TokenAccountInfo<'a, 'info>,
    pub token_program: TokenProgram<'a, 'info>,
    pub trader: Pubkey,
    pub market: Pubkey,
}

/// BatchUpdate account infos
pub(crate) struct BatchUpdateContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub market: ManifestAccountInfo<'a, 'info, MarketFixed>,
    pub system_program: Program<'a, 'info>,

    // One for each side. First is base, then is quote.
    pub global_trade_accounts_opts: [Option<GlobalTradeAccounts<'a, 'info>>; 2],
}

impl<'a, 'info> BatchUpdateContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new_payer(next_account_info(account_iter)?)?;
        let market: ManifestAccountInfo<MarketFixed> =
            ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
        let system_program: Program =
            Program::new(next_account_info(account_iter)?, &system_program::id())?;

        let mut global_trade_accounts_opts: [Option<GlobalTradeAccounts<'a, 'info>>; 2] =
            [None, None];

        let market_fixed: Ref<MarketFixed> = market.get_fixed()?;
        let base_mint: Pubkey = *market_fixed.get_base_mint();
        let quote_mint: Pubkey = *market_fixed.get_quote_mint();
        let base_vault: Pubkey = *market_fixed.get_base_vault();
        let quote_vault: Pubkey = *market_fixed.get_quote_vault();
        drop(market_fixed);

        for _ in 0..2 {
            let next_account_info_or: Result<&AccountInfo<'info>, ProgramError> =
                next_account_info(account_iter);
            if next_account_info_or.is_ok() {
                let mint: MintAccountInfo<'a, 'info> = MintAccountInfo::new(next_account_info_or?)?;
                let global: ManifestAccountInfo<'a, 'info, GlobalFixed> =
                    ManifestAccountInfo::<GlobalFixed>::new(next_account_info(account_iter)?)?;
                let global_data: Ref<&mut [u8]> = global.data.borrow();
                let global_fixed: &GlobalFixed = get_helper::<GlobalFixed>(&global_data, 0_u32);
                let expected_global_vault_address: &Pubkey = global_fixed.get_vault();

                let global_vault: TokenAccountInfo<'a, 'info> =
                    TokenAccountInfo::new_with_owner_and_key(
                        next_account_info(account_iter)?,
                        mint.info.key,
                        &expected_global_vault_address,
                        &expected_global_vault_address,
                    )?;
                drop(global_data);
                let (index, expected_market_vault_address) = if base_mint == *mint.info.key {
                    (0, &base_vault)
                } else {
                    assert_with_msg(
                        quote_mint == *mint.info.key,
                        ManifestError::MissingGlobal,
                        "Unexpected global accounts",
                    )?;
                    (1, &quote_vault)
                };
                let market_vault: TokenAccountInfo<'a, 'info> =
                    TokenAccountInfo::new_with_owner_and_key(
                        next_account_info(account_iter)?,
                        mint.info.key,
                        &expected_market_vault_address,
                        &expected_market_vault_address,
                    )?;
                let token_program: TokenProgram<'a, 'info> =
                    TokenProgram::new(next_account_info(account_iter)?)?;

                global_trade_accounts_opts[index] = Some(GlobalTradeAccounts {
                    mint: Some(mint),
                    global,
                    global_vault,
                    market_vault,
                    token_program,
                    trader: *payer.info.key,
                    market: *market.info.key,
                })
            };
        }

        Ok(Self {
            payer,
            market,
            system_program,
            global_trade_accounts_opts,
        })
    }
}

/// Global create
pub(crate) struct GlobalCreateContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub global: EmptyAccount<'a, 'info>,
    pub system_program: Program<'a, 'info>,
    pub global_mint: MintAccountInfo<'a, 'info>,
    pub global_vault: EmptyAccount<'a, 'info>,
    pub token_program: TokenProgram<'a, 'info>,
}

impl<'a, 'info> GlobalCreateContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new_payer(next_account_info(account_iter)?)?;
        let global: EmptyAccount = EmptyAccount::new(next_account_info(account_iter)?)?;
        let system_program: Program =
            Program::new(next_account_info(account_iter)?, &system_program::id())?;
        let global_mint: MintAccountInfo = MintAccountInfo::new(next_account_info(account_iter)?)?;
        // Address of the global vault is verified in the handler because the
        // create will only work if the signer seeds match.
        let global_vault: EmptyAccount = EmptyAccount::new(next_account_info(account_iter)?)?;
        let token_program: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
        Ok(Self {
            payer,
            global,
            system_program,
            global_mint,
            global_vault,
            token_program,
        })
    }
}

/// Global add trader
pub(crate) struct GlobalAddTraderContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub global: ManifestAccountInfo<'a, 'info, GlobalFixed>,
    pub system_program: Program<'a, 'info>,
}

impl<'a, 'info> GlobalAddTraderContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new_payer(next_account_info(account_iter)?)?;
        let global: ManifestAccountInfo<GlobalFixed> =
            ManifestAccountInfo::<GlobalFixed>::new(next_account_info(account_iter)?)?;
        let system_program: Program =
            Program::new(next_account_info(account_iter)?, &system_program::id())?;
        Ok(Self {
            payer,
            global,
            system_program,
        })
    }
}

/// Global deposit
pub(crate) struct GlobalDepositContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub global: ManifestAccountInfo<'a, 'info, GlobalFixed>,
    pub mint: MintAccountInfo<'a, 'info>,
    pub global_vault: TokenAccountInfo<'a, 'info>,
    pub trader_token: TokenAccountInfo<'a, 'info>,
    pub token_program: TokenProgram<'a, 'info>,
}

impl<'a, 'info> GlobalDepositContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new_payer(next_account_info(account_iter)?)?;
        let global: ManifestAccountInfo<GlobalFixed> =
            ManifestAccountInfo::<GlobalFixed>::new(next_account_info(account_iter)?)?;

        let mint: MintAccountInfo = MintAccountInfo::new(next_account_info(account_iter)?)?;

        let global_data: Ref<&mut [u8]> = global.data.borrow();
        let global_fixed: &GlobalFixed = get_helper::<GlobalFixed>(&global_data, 0_u32);
        let expected_global_vault_address: &Pubkey = global_fixed.get_vault();

        let global_vault: TokenAccountInfo = TokenAccountInfo::new_with_owner_and_key(
            next_account_info(account_iter)?,
            mint.info.key,
            &expected_global_vault_address,
            &expected_global_vault_address,
        )?;
        drop(global_data);

        let token_account_info: &AccountInfo<'info> = next_account_info(account_iter)?;
        let trader_token: TokenAccountInfo =
            TokenAccountInfo::new_with_owner(token_account_info, mint.info.key, payer.key)?;
        let token_program: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
        Ok(Self {
            payer,
            global,
            mint,
            global_vault,
            trader_token,
            token_program,
        })
    }
}

/// Global withdraw
pub(crate) struct GlobalWithdrawContext<'a, 'info> {
    pub payer: Signer<'a, 'info>,
    pub global: ManifestAccountInfo<'a, 'info, GlobalFixed>,
    pub mint: MintAccountInfo<'a, 'info>,
    pub global_vault: TokenAccountInfo<'a, 'info>,
    pub trader_token: TokenAccountInfo<'a, 'info>,
    pub token_program: TokenProgram<'a, 'info>,
}

impl<'a, 'info> GlobalWithdrawContext<'a, 'info> {
    pub fn load(accounts: &'a [AccountInfo<'info>]) -> Result<Self, ProgramError> {
        let account_iter: &mut Iter<AccountInfo<'info>> = &mut accounts.iter();

        let payer: Signer = Signer::new_payer(next_account_info(account_iter)?)?;
        let global: ManifestAccountInfo<GlobalFixed> =
            ManifestAccountInfo::<GlobalFixed>::new(next_account_info(account_iter)?)?;

        let mint: MintAccountInfo = MintAccountInfo::new(next_account_info(account_iter)?)?;

        let global_data: Ref<&mut [u8]> = global.data.borrow();
        let global_fixed: &GlobalFixed = get_helper::<GlobalFixed>(&global_data, 0_u32);
        let expected_global_vault_address: &Pubkey = global_fixed.get_vault();

        let global_vault: TokenAccountInfo = TokenAccountInfo::new_with_owner_and_key(
            next_account_info(account_iter)?,
            mint.info.key,
            &expected_global_vault_address,
            &expected_global_vault_address,
        )?;
        drop(global_data);

        let token_account_info: &AccountInfo<'info> = next_account_info(account_iter)?;
        let trader_token: TokenAccountInfo =
            TokenAccountInfo::new_with_owner(token_account_info, mint.info.key, payer.key)?;
        let token_program: TokenProgram = TokenProgram::new(next_account_info(account_iter)?)?;
        Ok(Self {
            payer,
            global,
            mint,
            global_vault,
            trader_token,
            token_program,
        })
    }
}
