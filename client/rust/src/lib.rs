use anyhow::{Error, Result};
use jupiter_amm_interface::{
    AccountMap, Amm, AmmContext, KeyedAccount, Quote, QuoteParams, Side, Swap, SwapAndAccountMetas,
    SwapParams,
};

use hypertree::{get_helper, get_mut_helper};
use manifest::{
    quantities::{BaseAtoms, QuoteAtoms, WrapperU64},
    state::{
        DynamicAccount, GlobalFixed, GlobalValue, MarketFixed, MarketValue, GLOBAL_FIXED_SIZE,
    },
    validation::{
        get_global_address, get_global_vault_address, get_vault_address,
        loaders::GlobalTradeAccounts, ManifestAccountInfo,
    },
};
use solana_program::{account_info::AccountInfo, system_program};
use solana_sdk::{instruction::AccountMeta, pubkey::Pubkey};
use std::{cell::RefCell, mem::size_of, rc::Rc};

macro_rules! dynamic_value_opt_to_account_info {
    ( $name:ident, $value_opt:expr, $fixed_size:expr, $type:ident, $key:expr ) => {
        let mut data_vec: Vec<u8> = Vec::new();
        if $value_opt.is_some() {
            let mut header_bytes: [u8; $fixed_size] = [0; $fixed_size];
            *get_mut_helper::<$type>(&mut header_bytes, 0_u32) = $value_opt.as_ref().unwrap().fixed;
            data_vec.extend_from_slice(&header_bytes);
            data_vec.append(&mut $value_opt.as_ref().unwrap().dynamic.clone());
        }

        let mut lamports: u64 = 0;
        let $name: AccountInfo<'_> = AccountInfo {
            key: &$key,
            lamports: Rc::new(RefCell::new(&mut lamports)),
            data: Rc::new(RefCell::new(&mut data_vec[..])),
            owner: &manifest::ID,
            rent_epoch: 0,
            is_signer: false,
            is_writable: false,
            executable: false,
        };
    };
}

#[derive(Clone)]
pub struct ManifestLocalMarket {
    market: MarketValue,
    key: Pubkey,
    label: String,
    base_token_program: Pubkey,
    quote_token_program: Pubkey,
}

impl ManifestLocalMarket {
    pub fn get_base_mint(&self) -> Pubkey {
        *self.market.get_base_mint()
    }
    pub fn get_quote_mint(&self) -> Pubkey {
        *self.market.get_quote_mint()
    }
}

impl Amm for ManifestLocalMarket {
    fn label(&self) -> String {
        self.label.clone()
    }

    fn key(&self) -> Pubkey {
        self.key
    }

    fn program_id(&self) -> Pubkey {
        manifest::id()
    }

    fn get_reserve_mints(&self) -> Vec<Pubkey> {
        vec![self.get_base_mint(), self.get_quote_mint()]
    }

    fn get_accounts_to_update(&self) -> Vec<Pubkey> {
        vec![self.key, self.get_base_mint(), self.get_quote_mint()]
    }

    fn from_keyed_account(keyed_account: &KeyedAccount, _amm_context: &AmmContext) -> Result<Self> {
        let mut_data: &mut &[u8] = &mut keyed_account.account.data.as_slice();

        let (header_bytes, dynamic_data) = mut_data.split_at(size_of::<MarketFixed>());
        let market_fixed: &MarketFixed = get_helper::<MarketFixed>(header_bytes, 0_u32);

        Ok(ManifestLocalMarket {
            market: DynamicAccount::<MarketFixed, Vec<u8>> {
                fixed: *market_fixed,
                dynamic: dynamic_data.to_vec(),
            },
            key: keyed_account.key,
            label: "Manifest".into(),
            // Gets updated on the first iter
            base_token_program: spl_token::id(),
            quote_token_program: spl_token::id(),
        })
    }

    fn update(&mut self, account_map: &AccountMap) -> Result<()> {
        if let Some(mint) = account_map.get(&self.get_base_mint()) {
            self.base_token_program = mint.owner;
        };
        if let Some(mint) = account_map.get(&self.get_quote_mint()) {
            self.quote_token_program = mint.owner;
        };

        let market_account: &solana_sdk::account::Account = account_map.get(&self.key).unwrap();

        let (header_bytes, dynamic_data) = market_account.data.split_at(size_of::<MarketFixed>());
        let market_fixed: &MarketFixed = get_helper::<MarketFixed>(header_bytes, 0_u32);
        self.market = DynamicAccount::<MarketFixed, Vec<u8>> {
            fixed: *market_fixed,
            dynamic: dynamic_data.to_vec(),
        };
        Ok(())
    }

    fn quote(&self, quote_params: &QuoteParams) -> Result<Quote> {
        let market: DynamicAccount<MarketFixed, Vec<u8>> = self.market.clone();

        let global_trade_accounts: &[Option<GlobalTradeAccounts>; 2] = &[None, None];

        let out_amount: u64 = if quote_params.input_mint == self.get_base_mint() {
            let in_atoms: BaseAtoms = BaseAtoms::new(quote_params.amount);
            market
                .impact_quote_atoms_with_slot(false, in_atoms, global_trade_accounts, u32::MAX)?
                .as_u64()
        } else {
            let in_atoms: QuoteAtoms = QuoteAtoms::new(quote_params.amount);
            market
                .impact_base_atoms_with_slot(true, in_atoms, global_trade_accounts, u32::MAX)?
                .as_u64()
        };
        Ok(Quote {
            out_amount,
            ..Quote::default()
        })
    }

    /// ManifestLocalMarket::update should be called once before calling this method
    fn get_swap_and_account_metas(&self, swap_params: &SwapParams) -> Result<SwapAndAccountMetas> {
        let SwapParams {
            destination_mint,
            source_mint,
            source_token_account,
            destination_token_account,
            token_transfer_authority,
            ..
        } = swap_params;

        let (side, base_account, quote_account) = if source_mint == &self.get_base_mint() {
            if destination_mint != &self.get_quote_mint() {
                return Err(Error::msg("Invalid quote mint"));
            }
            (Side::Ask, source_token_account, destination_token_account)
        } else {
            if destination_mint != &self.get_base_mint() {
                return Err(Error::msg("Invalid base mint"));
            }
            (Side::Bid, destination_token_account, source_token_account)
        };

        let (base_vault, _base_bump) = get_vault_address(&self.key, &self.get_base_mint());
        let (quote_vault, _quote_bump) = get_vault_address(&self.key, &self.get_quote_mint());

        let account_metas: Vec<AccountMeta> = vec![
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(*token_transfer_authority, true),
            AccountMeta::new(self.key, false),
            AccountMeta::new(system_program::id(), false),
            AccountMeta::new(*base_account, false),
            AccountMeta::new(*quote_account, false),
            AccountMeta::new(base_vault, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(self.base_token_program, false),
            AccountMeta::new_readonly(self.get_base_mint(), false),
            AccountMeta::new_readonly(self.quote_token_program, false),
            AccountMeta::new_readonly(self.get_quote_mint(), false),
        ];

        Ok(SwapAndAccountMetas {
            swap: Swap::Openbook { side },
            account_metas,
        })
    }

    fn clone_amm(&self) -> Box<dyn Amm + Send + Sync> {
        Box::new(self.clone())
    }

    fn has_dynamic_accounts(&self) -> bool {
        false
    }

    fn get_user_setup(&self) -> Option<jupiter_amm_interface::AmmUserSetup> {
        None
    }

    fn unidirectional(&self) -> bool {
        false
    }

    fn program_dependencies(&self) -> Vec<(Pubkey, String)> {
        std::vec![]
    }

    fn get_accounts_len(&self) -> usize {
        // 1   Program
        // 2   Market
        // 3   Signer
        // 4   SystemProgram
        // 5   User Base
        // 6   User Quote
        // 7   Vault Base
        // 8   Vault Quote
        // 9   Base Token Program
        // 10  Base Mint
        // 11  Quote Token Program
        // 12  Quote Mint
        12
    }
}

#[derive(Clone)]
pub struct ManifestMarket {
    market: MarketValue,
    key: Pubkey,
    label: String,
    base_global: Option<GlobalValue>,
    quote_global: Option<GlobalValue>,
    base_token_program: Pubkey,
    quote_token_program: Pubkey,
}

impl ManifestMarket {
    pub fn get_base_mint(&self) -> Pubkey {
        *self.market.get_base_mint()
    }
    pub fn get_quote_mint(&self) -> Pubkey {
        *self.market.get_quote_mint()
    }
    pub fn get_base_global_address(&self) -> Pubkey {
        get_global_address(self.market.get_base_mint()).0
    }
    pub fn get_quote_global_address(&self) -> Pubkey {
        get_global_address(self.market.get_quote_mint()).0
    }
}

impl Amm for ManifestMarket {
    fn label(&self) -> String {
        self.label.clone()
    }

    fn key(&self) -> Pubkey {
        self.key
    }

    fn program_id(&self) -> Pubkey {
        manifest::id()
    }

    fn get_reserve_mints(&self) -> Vec<Pubkey> {
        vec![self.get_base_mint(), self.get_quote_mint()]
    }

    fn get_accounts_to_update(&self) -> Vec<Pubkey> {
        vec![
            self.key,
            self.get_base_mint(),
            self.get_quote_mint(),
            self.get_base_global_address(),
            self.get_quote_global_address(),
        ]
    }

    fn from_keyed_account(keyed_account: &KeyedAccount, _amm_context: &AmmContext) -> Result<Self> {
        let mut_data: &mut &[u8] = &mut keyed_account.account.data.as_slice();

        let (header_bytes, dynamic_data) = mut_data.split_at(size_of::<MarketFixed>());
        let market_fixed: &MarketFixed = get_helper::<MarketFixed>(header_bytes, 0_u32);

        Ok(ManifestMarket {
            market: DynamicAccount::<MarketFixed, Vec<u8>> {
                fixed: *market_fixed,
                dynamic: dynamic_data.to_vec(),
            },
            key: keyed_account.key,
            label: "Manifest".into(),
            // Gets updated on the first iter
            base_token_program: spl_token::id(),
            quote_token_program: spl_token::id(),
            base_global: None,
            quote_global: None,
        })
    }

    fn update(&mut self, account_map: &AccountMap) -> Result<()> {
        if let Some(mint) = account_map.get(&self.get_base_mint()) {
            self.base_token_program = mint.owner;
        };
        if let Some(mint) = account_map.get(&self.get_quote_mint()) {
            self.quote_token_program = mint.owner;
        };
        if let Some(global) = account_map.get(&self.get_quote_global_address()) {
            let (header_bytes, dynamic_data) = global.data.split_at(size_of::<GlobalFixed>());
            let global_fixed: &GlobalFixed = get_helper::<GlobalFixed>(header_bytes, 0_u32);
            self.quote_global = Some(DynamicAccount::<GlobalFixed, Vec<u8>> {
                fixed: *global_fixed,
                dynamic: dynamic_data.to_vec(),
            });
        };
        if let Some(global) = account_map.get(&self.get_base_global_address()) {
            let (header_bytes, dynamic_data) = global.data.split_at(size_of::<GlobalFixed>());
            let global_fixed: &GlobalFixed = get_helper::<GlobalFixed>(header_bytes, 0_u32);
            self.base_global = Some(DynamicAccount::<GlobalFixed, Vec<u8>> {
                fixed: *global_fixed,
                dynamic: dynamic_data.to_vec(),
            });
        };

        let market_account: &solana_sdk::account::Account = account_map.get(&self.key).unwrap();

        let (header_bytes, dynamic_data) = market_account.data.split_at(size_of::<MarketFixed>());
        let market_fixed: &MarketFixed = get_helper::<MarketFixed>(header_bytes, 0_u32);
        self.market = DynamicAccount::<MarketFixed, Vec<u8>> {
            fixed: *market_fixed,
            dynamic: dynamic_data.to_vec(),
        };
        Ok(())
    }

    fn quote(&self, quote_params: &QuoteParams) -> Result<Quote> {
        let market: DynamicAccount<MarketFixed, Vec<u8>> = self.market.clone();

        dynamic_value_opt_to_account_info!(
            quote_global_account_info,
            self.quote_global,
            GLOBAL_FIXED_SIZE,
            GlobalFixed,
            self.get_quote_global_address()
        );

        let quote_global_trade_accounts_opt: Option<GlobalTradeAccounts> =
            if self.quote_global.is_some() {
                Some(GlobalTradeAccounts {
                    mint_opt: None,
                    global: ManifestAccountInfo::new(&quote_global_account_info).unwrap(),
                    global_vault_opt: None,
                    market_vault_opt: None,
                    token_program_opt: None,
                    system_program: None,
                    gas_payer_opt: None,
                    gas_receiver_opt: None,
                    market: self.key.clone(),
                })
            } else {
                None
            };

        dynamic_value_opt_to_account_info!(
            base_global_account_info,
            self.base_global,
            GLOBAL_FIXED_SIZE,
            GlobalFixed,
            self.get_base_global_address()
        );

        let base_global_trade_accounts_opt: Option<GlobalTradeAccounts> =
            if self.base_global.is_some() {
                Some(GlobalTradeAccounts {
                    mint_opt: None,
                    global: ManifestAccountInfo::new(&base_global_account_info).unwrap(),
                    global_vault_opt: None,
                    market_vault_opt: None,
                    token_program_opt: None,
                    system_program: None,
                    gas_payer_opt: None,
                    gas_receiver_opt: None,
                    market: self.key.clone(),
                })
            } else {
                None
            };

        let global_trade_accounts: &[Option<GlobalTradeAccounts>; 2] = &[
            base_global_trade_accounts_opt,
            quote_global_trade_accounts_opt,
        ];

        let out_amount: u64 = if quote_params.input_mint == self.get_base_mint() {
            let in_atoms: BaseAtoms = BaseAtoms::new(quote_params.amount);
            market
                .impact_quote_atoms_with_slot(false, in_atoms, global_trade_accounts, u32::MAX)?
                .as_u64()
        } else {
            let in_atoms: QuoteAtoms = QuoteAtoms::new(quote_params.amount);
            market
                .impact_base_atoms_with_slot(true, in_atoms, global_trade_accounts, u32::MAX)?
                .as_u64()
        };
        Ok(Quote {
            // Artificially penalize by 1 atom to be worse than the non-global version.
            // This ensures that routes that can be filled without global accounts cause less
            // lock contention on the global accounts, which will allow them to be included
            // the block earlier. The UX improvement should be worth at least 1 atom.
            out_amount: out_amount.saturating_sub(1),
            ..Quote::default()
        })
    }

    fn get_swap_and_account_metas(&self, swap_params: &SwapParams) -> Result<SwapAndAccountMetas> {
        let SwapParams {
            destination_mint,
            source_mint,
            source_token_account,
            destination_token_account,
            token_transfer_authority,
            ..
        } = swap_params;

        let (side, base_account, quote_account) = if source_mint == &self.get_base_mint() {
            if destination_mint != &self.get_quote_mint() {
                return Err(Error::msg("Invalid quote mint"));
            }
            (Side::Ask, source_token_account, destination_token_account)
        } else {
            if destination_mint != &self.get_base_mint() {
                return Err(Error::msg("Invalid base mint"));
            }
            (Side::Bid, destination_token_account, source_token_account)
        };

        let (base_vault, _base_bump) = get_vault_address(&self.key, &self.get_base_mint());
        let (quote_vault, _quote_bump) = get_vault_address(&self.key, &self.get_quote_mint());
        let (global, _global_bump) = get_global_address(destination_mint);
        let (global_vault, _global_vault_bump) = get_global_vault_address(destination_mint);

        let account_metas: Vec<AccountMeta> = vec![
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(*token_transfer_authority, true),
            AccountMeta::new(self.key, false),
            AccountMeta::new(system_program::id(), false),
            AccountMeta::new(*base_account, false),
            AccountMeta::new(*quote_account, false),
            AccountMeta::new(base_vault, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(self.base_token_program, false),
            AccountMeta::new_readonly(self.get_base_mint(), false),
            AccountMeta::new_readonly(self.quote_token_program, false),
            AccountMeta::new_readonly(self.get_quote_mint(), false),
            AccountMeta::new(global, false),
            AccountMeta::new(global_vault, false),
        ];

        Ok(SwapAndAccountMetas {
            swap: Swap::Openbook { side },
            account_metas,
        })
    }

    fn clone_amm(&self) -> Box<dyn Amm + Send + Sync> {
        Box::new(self.clone())
    }

    fn has_dynamic_accounts(&self) -> bool {
        false
    }

    fn get_user_setup(&self) -> Option<jupiter_amm_interface::AmmUserSetup> {
        None
    }

    fn unidirectional(&self) -> bool {
        false
    }

    fn program_dependencies(&self) -> Vec<(Pubkey, String)> {
        std::vec![]
    }

    fn get_accounts_len(&self) -> usize {
        // 1   Program
        // 2   Market
        // 3   Signer
        // 4   System Program
        // 5   User Base
        // 6   User Quote
        // 7   Vault Base
        // 8   Vault Quote
        // 9   Base Token Program
        // 10  Base Mint
        // 11  Quote Token Program
        // 12  Quote Mint
        // 13  Global
        // 14  Global Vault
        14
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use hypertree::{get_mut_helper, DataIndex};
    use jupiter_amm_interface::{ClockRef, SwapMode};
    use manifest::{
        quantities::{BaseAtoms, GlobalAtoms},
        state::{
            constants::NO_EXPIRATION_LAST_VALID_SLOT, AddOrderToMarketArgs, OrderType,
            GLOBAL_BLOCK_SIZE, MARKET_BLOCK_SIZE, MARKET_FIXED_SIZE,
        },
        validation::{MintAccountInfo, Signer},
    };
    use solana_sdk::{account::Account, account_info::AccountInfo, pubkey};
    use spl_token_2022::state::Mint;
    use std::{cell::RefCell, collections::HashMap, rc::Rc};

    const BASE_MINT_KEY: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
    const QUOTE_MINT_KEY: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const MARKET_KEY: Pubkey = pubkey!("GPPda3ZQZannxp3AK8bSishVqvhHAxogiWdhw1mvmoZr");
    const TRADER_KEY: Pubkey = pubkey!("GCtjtH2ehL6BZTjismuZ8JhQnuM6U3bmtxVoFyiHMHGc");

    macro_rules! mint_account_info {
        ($name:ident, $decimals:expr) => {
            let mut lamports: u64 = 0;
            let $name: MintAccountInfo = MintAccountInfo {
                mint: Mint {
                    mint_authority: None.into(),
                    supply: 0,
                    decimals: $decimals,
                    is_initialized: true,
                    freeze_authority: None.into(),
                },
                info: &AccountInfo {
                    key: if $decimals == 9 {
                        &BASE_MINT_KEY
                    } else {
                        &QUOTE_MINT_KEY
                    },
                    lamports: Rc::new(RefCell::new(&mut lamports)),
                    data: Rc::new(RefCell::new(&mut [])),
                    owner: &Pubkey::new_unique(),
                    rent_epoch: 0,
                    is_signer: false,
                    is_writable: false,
                    executable: false,
                },
            };
        };
    }

    macro_rules! dynamic_value_to_account {
        ( $name:ident, $value:expr, $fixed_size:expr, $type:ident ) => {
            let mut header_bytes: [u8; $fixed_size] = [0; $fixed_size];
            *get_mut_helper::<$type>(&mut header_bytes, 0_u32) = $value.fixed;

            let mut data_vec: Vec<u8> = Vec::new();
            data_vec.extend_from_slice(&header_bytes);
            data_vec.append(&mut $value.dynamic);

            let $name: Account = Account {
                lamports: 0,
                data: data_vec,
                owner: manifest::id(),
                executable: false,
                rent_epoch: 0,
            };
        };
    }

    macro_rules! signer {
        ( $name:ident) => {
            let mut lamports: u64 = 1_000_000_000;
            let account_info: AccountInfo<'_> = AccountInfo {
                key: &TRADER_KEY,
                lamports: Rc::new(RefCell::new(&mut lamports)),
                data: Rc::new(RefCell::new(&mut [])),
                owner: &manifest::ID,
                rent_epoch: 0,
                is_signer: true,
                is_writable: false,
                executable: false,
            };
            let $name = Signer::new(&account_info).expect("valid signer");
        };
    }

    #[test]
    fn test_jupiter_global_with_global_orders() {
        mint_account_info!(base_mint, 9);
        mint_account_info!(quote_mint, 6);
        let quote_global_key: Pubkey = get_global_address(&QUOTE_MINT_KEY).0;

        let mut quote_global_value: DynamicAccount<GlobalFixed, Vec<u8>> = GlobalValue {
            fixed: GlobalFixed::new_empty(&QUOTE_MINT_KEY),
            // 2 because 1 deposit, 1 seat
            dynamic: vec![0; GLOBAL_BLOCK_SIZE * 2],
        };
        // Claim a seat and deposit plenty of quote atoms.
        quote_global_value.global_expand().expect("global expand");
        quote_global_value
            .add_trader(&TRADER_KEY)
            .expect("claim global seat");
        quote_global_value
            .deposit_global(&TRADER_KEY, GlobalAtoms::new(1_000_000_000))
            .expect("deposit quote global");

        // Clone so the consumed bytes are available for the global trade
        // accounts later when quoting.
        dynamic_value_opt_to_account_info!(
            quote_global_account_info,
            Some(quote_global_value.clone()),
            GLOBAL_FIXED_SIZE,
            GlobalFixed,
            quote_global_key
        );
        signer!(gas_payer_account_info);

        let quote_global_trade_accounts: Option<GlobalTradeAccounts<'_, '_>> =
            Some(GlobalTradeAccounts {
                mint_opt: None,
                global: ManifestAccountInfo::new(&quote_global_account_info).unwrap(),
                global_vault_opt: None,
                market_vault_opt: None,
                token_program_opt: None,
                system_program: None,
                gas_payer_opt: Some(gas_payer_account_info),
                gas_receiver_opt: None,
                market: MARKET_KEY,
            });

        dynamic_value_to_account!(
            quote_global_account,
            quote_global_value,
            GLOBAL_FIXED_SIZE,
            GlobalFixed
        );

        let mut market_value: DynamicAccount<MarketFixed, Vec<u8>> = MarketValue {
            fixed: MarketFixed::new_empty(&base_mint, &quote_mint, &MARKET_KEY),
            // 4 because 1 extra, 1 seat, 2 orders.
            dynamic: vec![0; MARKET_BLOCK_SIZE * 4],
        };
        // Claim a seat and deposit plenty on both sides.
        market_value.market_expand().unwrap();
        market_value.claim_seat(&TRADER_KEY).unwrap();
        let trader_index: DataIndex = market_value.get_trader_index(&TRADER_KEY);
        market_value
            .deposit(trader_index, 1_000_000_000_000, true)
            .unwrap();
        market_value
            .deposit(trader_index, 1_000_000_000_000, false)
            .unwrap();

        // Bid for 10 SOL@ 150USDC/SOL global
        market_value.market_expand().unwrap();
        market_value
            .place_order(AddOrderToMarketArgs {
                market: MARKET_KEY,
                trader_index,
                num_base_atoms: BaseAtoms::new(10_000),
                price: 0.150.try_into().unwrap(),
                is_bid: true,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Global,
                global_trade_accounts_opts: &[None, quote_global_trade_accounts],
                current_slot: None,
            })
            .unwrap();

        // Ask 10 SOL @ 180USDC/SOL
        market_value.market_expand().unwrap();
        market_value
            .place_order(AddOrderToMarketArgs {
                market: MARKET_KEY,
                trader_index,
                num_base_atoms: BaseAtoms::new(10_000),
                price: 0.180.try_into().unwrap(),
                is_bid: false,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: None,
            })
            .unwrap();

        dynamic_value_to_account!(market_account, market_value, MARKET_FIXED_SIZE, MarketFixed);

        let market_keyed_account: KeyedAccount = KeyedAccount {
            key: MARKET_KEY,
            account: market_account.clone(),
            params: None,
        };

        let amm_context: AmmContext = AmmContext {
            clock_ref: ClockRef::default(),
        };

        let mut manifest_market: ManifestMarket =
            ManifestMarket::from_keyed_account(&market_keyed_account, &amm_context).unwrap();

        let accounts_map: AccountMap = HashMap::from([
            (MARKET_KEY, market_account),
            (quote_global_key, quote_global_account),
            (
                BASE_MINT_KEY,
                Account {
                    lamports: 0,
                    data: Vec::new(),
                    owner: spl_token::id(),
                    executable: false,
                    rent_epoch: 0,
                },
            ),
            (
                QUOTE_MINT_KEY,
                Account {
                    lamports: 0,
                    data: Vec::new(),
                    owner: spl_token::id(),
                    executable: false,
                    rent_epoch: 0,
                },
            ),
        ]);
        manifest_market.update(&accounts_map).unwrap();

        let (base_mint, quote_mint) = {
            let reserves: Vec<Pubkey> = manifest_market.get_reserve_mints();
            (reserves[0], reserves[1])
        };

        // Ask for 1 SOL, Bid for 180 USDC
        for (side, in_amount) in [(Side::Ask, 1_000_000_000), (Side::Bid, 180_000_000)] {
            let (input_mint, output_mint) = match side {
                Side::Ask => (base_mint, quote_mint),
                Side::Bid => (quote_mint, base_mint),
            };

            let quote_params: QuoteParams = QuoteParams {
                amount: in_amount,
                swap_mode: SwapMode::ExactIn,
                input_mint,
                output_mint,
            };

            let quote: Quote = manifest_market.quote(&quote_params).unwrap();

            match side {
                Side::Ask => {
                    assert_eq!(quote.out_amount, 1_499);
                }
                Side::Bid => {
                    assert_eq!(quote.out_amount, 9_999);
                }
            };
        }
    }

    #[test]
    fn test_jupiter_local_with_global_orders() {
        mint_account_info!(base_mint, 9);
        mint_account_info!(quote_mint, 6);
        let quote_global_key: Pubkey = get_global_address(&QUOTE_MINT_KEY).0;

        let mut quote_global_value: DynamicAccount<GlobalFixed, Vec<u8>> = GlobalValue {
            fixed: GlobalFixed::new_empty(&QUOTE_MINT_KEY),
            // 2 because 1 deposit, 1 seat
            dynamic: vec![0; GLOBAL_BLOCK_SIZE * 2],
        };
        // Claim a seat and deposit plenty of quote atoms.
        quote_global_value.global_expand().expect("global expand");
        quote_global_value
            .add_trader(&TRADER_KEY)
            .expect("claim global seat");
        quote_global_value
            .deposit_global(&TRADER_KEY, GlobalAtoms::new(1_000_000_000))
            .expect("deposit quote global");

        // Clone so the consumed bytes are available for the global trade
        // accounts later when quoting.
        dynamic_value_opt_to_account_info!(
            quote_global_account_info,
            Some(quote_global_value.clone()),
            GLOBAL_FIXED_SIZE,
            GlobalFixed,
            quote_global_key
        );
        signer!(gas_payer_account_info);

        let quote_global_trade_accounts: Option<GlobalTradeAccounts<'_, '_>> =
            Some(GlobalTradeAccounts {
                mint_opt: None,
                global: ManifestAccountInfo::new(&quote_global_account_info).unwrap(),
                global_vault_opt: None,
                market_vault_opt: None,
                token_program_opt: None,
                system_program: None,
                gas_payer_opt: Some(gas_payer_account_info),
                gas_receiver_opt: None,
                market: MARKET_KEY,
            });

        let mut market_value: DynamicAccount<MarketFixed, Vec<u8>> = MarketValue {
            fixed: MarketFixed::new_empty(&base_mint, &quote_mint, &MARKET_KEY),
            // 4 because 1 extra, 1 seat, 2 orders.
            dynamic: vec![0; MARKET_BLOCK_SIZE * 4],
        };
        // Claim a seat and deposit plenty on both sides.
        market_value.market_expand().unwrap();
        market_value.claim_seat(&TRADER_KEY).unwrap();
        let trader_index: DataIndex = market_value.get_trader_index(&TRADER_KEY);
        market_value
            .deposit(trader_index, 1_000_000_000_000, true)
            .unwrap();
        market_value
            .deposit(trader_index, 1_000_000_000_000, false)
            .unwrap();

        // Bid for 10 SOL@ 150USDC/SOL global
        market_value.market_expand().unwrap();
        market_value
            .place_order(AddOrderToMarketArgs {
                market: MARKET_KEY,
                trader_index,
                num_base_atoms: BaseAtoms::new(10_000),
                price: 0.150.try_into().unwrap(),
                is_bid: true,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Global,
                global_trade_accounts_opts: &[None, quote_global_trade_accounts],
                current_slot: None,
            })
            .unwrap();

        // Ask 10 SOL @ 180USDC/SOL
        market_value.market_expand().unwrap();
        market_value
            .place_order(AddOrderToMarketArgs {
                market: MARKET_KEY,
                trader_index,
                num_base_atoms: BaseAtoms::new(10_000),
                price: 0.180.try_into().unwrap(),
                is_bid: false,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: None,
            })
            .unwrap();

        dynamic_value_to_account!(market_account, market_value, MARKET_FIXED_SIZE, MarketFixed);

        let market_keyed_account: KeyedAccount = KeyedAccount {
            key: MARKET_KEY,
            account: market_account.clone(),
            params: None,
        };

        let amm_context: AmmContext = AmmContext {
            clock_ref: ClockRef::default(),
        };

        let mut manifest_market: ManifestLocalMarket =
            ManifestLocalMarket::from_keyed_account(&market_keyed_account, &amm_context).unwrap();

        let accounts_map: AccountMap = HashMap::from([
            (MARKET_KEY, market_account),
            (
                BASE_MINT_KEY,
                Account {
                    lamports: 0,
                    data: Vec::new(),
                    owner: spl_token::id(),
                    executable: false,
                    rent_epoch: 0,
                },
            ),
            (
                QUOTE_MINT_KEY,
                Account {
                    lamports: 0,
                    data: Vec::new(),
                    owner: spl_token::id(),
                    executable: false,
                    rent_epoch: 0,
                },
            ),
        ]);
        manifest_market.update(&accounts_map).unwrap();

        let (base_mint, quote_mint) = {
            let reserves: Vec<Pubkey> = manifest_market.get_reserve_mints();
            (reserves[0], reserves[1])
        };

        // Ask for 1 SOL, Bid for 180 USDC
        for (side, in_amount) in [(Side::Ask, 1_000_000_000), (Side::Bid, 180_000_000)] {
            let (input_mint, output_mint) = match side {
                Side::Ask => (base_mint, quote_mint),
                Side::Bid => (quote_mint, base_mint),
            };

            let quote_params: QuoteParams = QuoteParams {
                amount: in_amount,
                swap_mode: SwapMode::ExactIn,
                input_mint,
                output_mint,
            };

            let quote: Quote = manifest_market.quote(&quote_params).unwrap();

            // Ignores globals.
            match side {
                Side::Ask => {
                    assert_eq!(quote.out_amount, 0);
                }
                Side::Bid => {
                    // Global is only on the resting bid side. No penalty.
                    assert_eq!(quote.out_amount, 10_000);
                }
            };
        }
    }

    #[test]
    fn test_jupiter_local_with_local_orders() {
        mint_account_info!(base_mint, 9);
        mint_account_info!(quote_mint, 6);

        let mut market_value: DynamicAccount<MarketFixed, Vec<u8>> = MarketValue {
            fixed: MarketFixed::new_empty(&base_mint, &quote_mint, &MARKET_KEY),
            // 4 because 1 extra, 1 seat, 2 orders.
            dynamic: vec![0; MARKET_BLOCK_SIZE * 4],
        };
        // Claim a seat and deposit plenty on both sides.
        market_value.market_expand().unwrap();
        market_value.claim_seat(&TRADER_KEY).unwrap();
        let trader_index: DataIndex = market_value.get_trader_index(&TRADER_KEY);
        market_value
            .deposit(trader_index, 1_000_000_000_000, true)
            .unwrap();
        market_value
            .deposit(trader_index, 1_000_000_000_000, false)
            .unwrap();

        // Bid for 10 SOL@ 150USDC/SOL global
        market_value.market_expand().unwrap();
        market_value
            .place_order(AddOrderToMarketArgs {
                market: MARKET_KEY,
                trader_index,
                num_base_atoms: BaseAtoms::new(10_000),
                price: 0.150.try_into().unwrap(),
                is_bid: true,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: None,
            })
            .unwrap();

        // Ask 10 SOL @ 180USDC/SOL
        market_value.market_expand().unwrap();
        market_value
            .place_order(AddOrderToMarketArgs {
                market: MARKET_KEY,
                trader_index,
                num_base_atoms: BaseAtoms::new(10_000),
                price: 0.180.try_into().unwrap(),
                is_bid: false,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: None,
            })
            .unwrap();

        dynamic_value_to_account!(market_account, market_value, MARKET_FIXED_SIZE, MarketFixed);

        let market_keyed_account: KeyedAccount = KeyedAccount {
            key: MARKET_KEY,
            account: market_account.clone(),
            params: None,
        };

        let amm_context: AmmContext = AmmContext {
            clock_ref: ClockRef::default(),
        };

        let mut manifest_market: ManifestLocalMarket =
            ManifestLocalMarket::from_keyed_account(&market_keyed_account, &amm_context).unwrap();

        let accounts_map: AccountMap = HashMap::from([(MARKET_KEY, market_account)]);
        manifest_market.update(&accounts_map).unwrap();

        let (base_mint, quote_mint) = {
            let reserves: Vec<Pubkey> = manifest_market.get_reserve_mints();
            (reserves[0], reserves[1])
        };

        // Ask for 1 SOL, Bid for 180 USDC
        for (side, in_amount) in [(Side::Ask, 1_000_000_000), (Side::Bid, 180_000_000)] {
            let (input_mint, output_mint) = match side {
                Side::Ask => (base_mint, quote_mint),
                Side::Bid => (quote_mint, base_mint),
            };

            let quote_params: QuoteParams = QuoteParams {
                amount: in_amount,
                swap_mode: SwapMode::ExactIn,
                input_mint,
                output_mint,
            };

            let quote: Quote = manifest_market.quote(&quote_params).unwrap();

            // Does not get the global single atom punishment.
            match side {
                Side::Ask => {
                    assert_eq!(quote.out_amount, 1_500);
                }
                Side::Bid => {
                    assert_eq!(quote.out_amount, 10_000);
                }
            };
        }
    }

    #[test]
    fn test_jupiter_other() {
        mint_account_info!(base_mint, 9);
        mint_account_info!(quote_mint, 6);

        let mut market_value: DynamicAccount<MarketFixed, Vec<u8>> = MarketValue {
            fixed: MarketFixed::new_empty(&base_mint, &quote_mint, &MARKET_KEY),
            // 4 because 1 extra, 1 seat, 2 orders.
            dynamic: vec![0; MARKET_BLOCK_SIZE * 4],
        };
        market_value.market_expand().unwrap();
        market_value.claim_seat(&TRADER_KEY).unwrap();
        let trader_index: DataIndex = market_value.get_trader_index(&TRADER_KEY);
        market_value
            .deposit(trader_index, 1_000_000_000_000, true)
            .unwrap();
        market_value
            .deposit(trader_index, 1_000_000_000_000, false)
            .unwrap();

        // Bid for 10 SOL
        market_value.market_expand().unwrap();
        market_value
            .place_order(AddOrderToMarketArgs {
                market: MARKET_KEY,
                trader_index,
                num_base_atoms: BaseAtoms::new(10_000),
                price: 0.150.try_into().unwrap(),
                is_bid: true,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: None,
            })
            .unwrap();

        // Ask 10 SOL
        market_value.market_expand().unwrap();
        market_value
            .place_order(AddOrderToMarketArgs {
                market: MARKET_KEY,
                trader_index,
                num_base_atoms: BaseAtoms::new(10_000),
                price: 0.180.try_into().unwrap(),
                is_bid: false,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: None,
            })
            .unwrap();

        let mut header_bytes: [u8; MARKET_FIXED_SIZE] = [0; MARKET_FIXED_SIZE];
        *get_mut_helper::<MarketFixed>(&mut header_bytes, 0_u32) = market_value.fixed;

        let mut data_vec: Vec<u8> = Vec::new();
        data_vec.extend_from_slice(&header_bytes);
        data_vec.append(&mut market_value.dynamic);

        let account: Account = Account {
            lamports: 0,
            data: data_vec,
            owner: manifest::id(),
            executable: false,
            rent_epoch: 0,
        };

        let market_account: KeyedAccount = KeyedAccount {
            key: MARKET_KEY,
            account: account.clone(),
            params: None,
        };

        let amm_context: AmmContext = AmmContext {
            clock_ref: ClockRef::default(),
        };
        let manifest_market: ManifestMarket =
            ManifestMarket::from_keyed_account(&market_account, &amm_context).unwrap();

        assert_eq!(manifest_market.get_accounts_len(), 14);
        assert_eq!(manifest_market.label(), "Manifest");
        assert_eq!(manifest_market.key(), MARKET_KEY);
        assert_eq!(manifest_market.program_id(), manifest::id());
        assert_eq!(manifest_market.get_reserve_mints()[0], BASE_MINT_KEY);
        assert_eq!(manifest_market.get_accounts_to_update().len(), 5);

        let swap_params: SwapParams = SwapParams {
            in_amount: 1,
            source_mint: manifest_market.get_base_mint(),
            destination_mint: manifest_market.get_quote_mint(),
            source_token_account: Pubkey::new_unique(),
            destination_token_account: Pubkey::new_unique(),
            token_transfer_authority: TRADER_KEY,
            missing_dynamic_accounts_as_default: false,
            open_order_address: None,
            quote_mint_to_referrer: None,
            out_amount: 0,
            jupiter_program_id: &manifest::id(),
        };

        let _results_forward: SwapAndAccountMetas = manifest_market
            .get_swap_and_account_metas(&swap_params)
            .unwrap();

        let swap_params: SwapParams = SwapParams {
            in_amount: 1,
            source_mint: manifest_market.get_quote_mint(),
            destination_mint: manifest_market.get_base_mint(),
            source_token_account: Pubkey::new_unique(),
            destination_token_account: Pubkey::new_unique(),
            token_transfer_authority: TRADER_KEY,
            missing_dynamic_accounts_as_default: false,
            open_order_address: None,
            quote_mint_to_referrer: None,
            out_amount: 0,
            jupiter_program_id: &manifest::id(),
        };

        let _results_backward: SwapAndAccountMetas = manifest_market
            .get_swap_and_account_metas(&swap_params)
            .unwrap();

        manifest_market.clone_amm();
        assert!(!manifest_market.has_dynamic_accounts());
        assert!(manifest_market.get_user_setup().is_none());
        assert!(!manifest_market.unidirectional());
        assert_eq!(manifest_market.program_dependencies().len(), 0);

        let manifest_local_market: ManifestLocalMarket =
            ManifestLocalMarket::from_keyed_account(&market_account, &amm_context).unwrap();
        assert_eq!(manifest_local_market.label(), "Manifest");
        assert_eq!(manifest_local_market.key(), MARKET_KEY);
        assert_eq!(manifest_local_market.program_id(), manifest::id());
        assert_eq!(manifest_local_market.get_accounts_to_update().len(), 3);
        assert_eq!(manifest_local_market.get_accounts_len(), 12);
        assert_eq!(manifest_local_market.get_reserve_mints()[0], BASE_MINT_KEY);
        manifest_local_market.clone_amm();
        assert!(!manifest_local_market.has_dynamic_accounts());
        assert!(manifest_local_market.get_user_setup().is_none());
        assert!(!manifest_local_market.unidirectional());
        assert_eq!(manifest_local_market.program_dependencies().len(), 0);

        let swap_params: SwapParams = SwapParams {
            in_amount: 1,
            source_mint: manifest_market.get_base_mint(),
            destination_mint: manifest_market.get_quote_mint(),
            source_token_account: Pubkey::new_unique(),
            destination_token_account: Pubkey::new_unique(),
            token_transfer_authority: TRADER_KEY,
            missing_dynamic_accounts_as_default: false,
            open_order_address: None,
            quote_mint_to_referrer: None,
            out_amount: 0,
            jupiter_program_id: &manifest::id(),
        };

        let _results_forward: SwapAndAccountMetas = manifest_local_market
            .get_swap_and_account_metas(&swap_params)
            .unwrap();

        let swap_params: SwapParams = SwapParams {
            in_amount: 1,
            source_mint: manifest_market.get_quote_mint(),
            destination_mint: manifest_market.get_base_mint(),
            source_token_account: Pubkey::new_unique(),
            destination_token_account: Pubkey::new_unique(),
            token_transfer_authority: TRADER_KEY,
            missing_dynamic_accounts_as_default: false,
            open_order_address: None,
            quote_mint_to_referrer: None,
            out_amount: 0,
            jupiter_program_id: &manifest::id(),
        };

        let _results_backward: SwapAndAccountMetas = manifest_local_market
            .get_swap_and_account_metas(&swap_params)
            .unwrap();
    }
}
