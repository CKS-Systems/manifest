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
use solana_program::account_info::AccountInfo;
use solana_sdk::{instruction::AccountMeta, pubkey::Pubkey};
use std::{cell::RefCell, mem::size_of, rc::Rc};

#[derive(Clone)]
pub struct ManifestGlobalMarket {
    market: MarketValue,
    key: Pubkey,
    label: String,
    base_global: Option<GlobalValue>,
    quote_global: Option<GlobalValue>,
    base_token_program: Pubkey,
    quote_token_program: Pubkey,
}

impl ManifestGlobalMarket {
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

impl Amm for ManifestGlobalMarket {
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

        Ok(ManifestGlobalMarket {
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

        let mut data_vec: Vec<u8> = Vec::new();
        if self.quote_global.is_some() {
            let mut header_bytes: [u8; GLOBAL_FIXED_SIZE] = [0; GLOBAL_FIXED_SIZE];
            *get_mut_helper::<GlobalFixed>(&mut header_bytes, 0_u32) =
                self.quote_global.as_ref().unwrap().fixed;
            data_vec.extend_from_slice(&header_bytes);
            data_vec.append(&mut self.quote_global.as_ref().unwrap().dynamic.clone());
        }

        let mut lamports: u64 = 0;
        let account_info: AccountInfo<'_> = AccountInfo {
            key: &self.get_quote_global_address(),
            lamports: Rc::new(RefCell::new(&mut lamports)),
            data: Rc::new(RefCell::new(&mut data_vec[..])),
            owner: &manifest::ID,
            rent_epoch: 0,
            is_signer: false,
            is_writable: false,
            executable: false,
        };
        let quote_global_trade_accounts_opt: Option<GlobalTradeAccounts> =
            if self.quote_global.is_some() {
                Some(GlobalTradeAccounts {
                    mint_opt: None,
                    global: ManifestAccountInfo::new(&account_info).unwrap(),
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

        let mut data_vec: Vec<u8> = Vec::new();
        if self.base_global.is_some() {
            let mut header_bytes: [u8; GLOBAL_FIXED_SIZE] = [0; GLOBAL_FIXED_SIZE];
            *get_mut_helper::<GlobalFixed>(&mut header_bytes, 0_u32) =
                self.base_global.as_ref().unwrap().fixed;
            data_vec.extend_from_slice(&header_bytes);
            data_vec.append(&mut self.base_global.as_ref().unwrap().dynamic.clone());
        }

        let mut lamports: u64 = 0;
        let account_info: AccountInfo<'_> = AccountInfo {
            key: &self.get_base_global_address(),
            lamports: Rc::new(RefCell::new(&mut lamports)),
            data: Rc::new(RefCell::new(&mut data_vec[..])),
            owner: &manifest::ID,
            rent_epoch: 0,
            is_signer: false,
            is_writable: false,
            executable: false,
        };
        let base_global_trade_accounts_opt: Option<GlobalTradeAccounts> =
            if self.base_global.is_some() {
                Some(GlobalTradeAccounts {
                    mint_opt: None,
                    global: ManifestAccountInfo::new(&account_info).unwrap(),
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
                .impact_quote_atoms(false, in_atoms, global_trade_accounts)?
                .as_u64()
        } else {
            let in_atoms: QuoteAtoms = QuoteAtoms::new(quote_params.amount);
            market
                .impact_base_atoms(true, in_atoms, global_trade_accounts)?
                .as_u64()
        };
        Ok(Quote {
            out_amount,
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
        // 4   User Base
        // 5   User Quote
        // 6   Vault Base
        // 7   Vault Quote
        // 8   Base Token Program
        // 9   Base Mint
        // 10  Quote Token Program
        // 11  Quote Mint
        // 12  Global
        // 13  Global Vault
        13
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use hypertree::{get_mut_helper, trace, DataIndex};
    use jupiter_amm_interface::{ClockRef, SwapMode};
    use manifest::{
        quantities::BaseAtoms,
        state::{
            constants::NO_EXPIRATION_LAST_VALID_SLOT, AddOrderToMarketArgs, OrderType,
            MARKET_BLOCK_SIZE, MARKET_FIXED_SIZE,
        },
        validation::MintAccountInfo,
    };
    use solana_sdk::{account::Account, account_info::AccountInfo};
    use spl_token_2022::state::Mint;
    use std::{cell::RefCell, collections::HashMap, rc::Rc, str::FromStr};

    #[test]
    fn test_jupiter_local() {
        let base_mint_key: Pubkey =
            Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let quote_mint_key: Pubkey =
            Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").unwrap();

        let mut lamports: u64 = 0;
        let base_mint: MintAccountInfo = MintAccountInfo {
            mint: Mint {
                mint_authority: None.into(),
                supply: 0,
                decimals: 6,
                is_initialized: true,
                freeze_authority: None.into(),
            },
            info: &AccountInfo {
                key: &base_mint_key,
                lamports: Rc::new(RefCell::new(&mut lamports)),
                data: Rc::new(RefCell::new(&mut [])),
                owner: &Pubkey::new_unique(),
                rent_epoch: 0,
                is_signer: false,
                is_writable: false,
                executable: false,
            },
        };

        let mut lamports: u64 = 0;
        let quote_mint: MintAccountInfo = MintAccountInfo {
            mint: Mint {
                mint_authority: None.into(),
                supply: 0,
                decimals: 9,
                is_initialized: true,
                freeze_authority: None.into(),
            },
            info: &AccountInfo {
                key: &quote_mint_key,
                lamports: Rc::new(RefCell::new(&mut lamports)),
                data: Rc::new(RefCell::new(&mut [])),
                owner: &Pubkey::new_unique(),
                rent_epoch: 0,
                is_signer: false,
                is_writable: false,
                executable: false,
            },
        };

        let market_key: Pubkey =
            Pubkey::from_str("GPPda3ZQZannxp3AK8bSishVqvhHAxogiWdhw1mvmoZr").unwrap();

        let mut market_value: DynamicAccount<MarketFixed, Vec<u8>> = MarketValue {
            fixed: MarketFixed::new_empty(&base_mint, &quote_mint, &market_key),
            // 4 because 1 extra, 1 seat, 2 orders.
            dynamic: vec![0; MARKET_BLOCK_SIZE * 4],
        };
        let trader_key: Pubkey =
            Pubkey::from_str("GCtjtH2ehL6BZTjismuZ8JhQnuM6U3bmtxVoFyiHMHGc").unwrap();
        market_value.market_expand().unwrap();
        market_value.claim_seat(&trader_key).unwrap();
        let trader_index: DataIndex = market_value.get_trader_index(&trader_key);
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
                market: market_key,
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
                market: market_key,
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
            key: market_key,
            account: account.clone(),
            params: None,
        };

        let amm_context: AmmContext = AmmContext {
            clock_ref: ClockRef::default(),
        };

        let mut manifest_market: ManifestGlobalMarket =
            ManifestGlobalMarket::from_keyed_account(&market_account, &amm_context).unwrap();

        let accounts_map: AccountMap = HashMap::from([(market_key, account)]);

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

            trace!("{:#?}", quote_params);
            trace!("{:#?}", quote);

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
        let base_mint_key: Pubkey =
            Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let quote_mint_key: Pubkey =
            Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").unwrap();

        let mut lamports: u64 = 0;
        let base_mint: MintAccountInfo = MintAccountInfo {
            mint: Mint {
                mint_authority: None.into(),
                supply: 0,
                decimals: 6,
                is_initialized: true,
                freeze_authority: None.into(),
            },
            info: &AccountInfo {
                key: &base_mint_key,
                lamports: Rc::new(RefCell::new(&mut lamports)),
                data: Rc::new(RefCell::new(&mut [])),
                owner: &Pubkey::new_unique(),
                rent_epoch: 0,
                is_signer: false,
                is_writable: false,
                executable: false,
            },
        };

        let mut lamports: u64 = 0;
        let quote_mint: MintAccountInfo = MintAccountInfo {
            mint: Mint {
                mint_authority: None.into(),
                supply: 0,
                decimals: 9,
                is_initialized: true,
                freeze_authority: None.into(),
            },
            info: &AccountInfo {
                key: &quote_mint_key,
                lamports: Rc::new(RefCell::new(&mut lamports)),
                data: Rc::new(RefCell::new(&mut [])),
                owner: &Pubkey::new_unique(),
                rent_epoch: 0,
                is_signer: false,
                is_writable: false,
                executable: false,
            },
        };

        let market_key: Pubkey =
            Pubkey::from_str("GPPda3ZQZannxp3AK8bSishVqvhHAxogiWdhw1mvmoZr").unwrap();

        let mut market_value: DynamicAccount<MarketFixed, Vec<u8>> = MarketValue {
            fixed: MarketFixed::new_empty(&base_mint, &quote_mint, &market_key),
            // 4 because 1 extra, 1 seat, 2 orders.
            dynamic: vec![0; MARKET_BLOCK_SIZE * 4],
        };
        let trader_key: Pubkey =
            Pubkey::from_str("GCtjtH2ehL6BZTjismuZ8JhQnuM6U3bmtxVoFyiHMHGc").unwrap();
        market_value.market_expand().unwrap();
        market_value.claim_seat(&trader_key).unwrap();
        let trader_index: DataIndex = market_value.get_trader_index(&trader_key);
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
                market: market_key,
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
                market: market_key,
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
            key: market_key,
            account: account.clone(),
            params: None,
        };

        let amm_context: AmmContext = AmmContext {
            clock_ref: ClockRef::default(),
        };
        let manifest_market: ManifestGlobalMarket =
            ManifestGlobalMarket::from_keyed_account(&market_account, &amm_context).unwrap();

        assert_eq!(manifest_market.get_accounts_len(), 13);
        assert_eq!(manifest_market.label(), "Manifest");
        assert_eq!(manifest_market.key(), market_key);
        assert_eq!(manifest_market.program_id(), manifest::id());
        assert_eq!(manifest_market.get_reserve_mints()[0], base_mint_key);
        assert_eq!(manifest_market.get_accounts_to_update().len(), 3);

        let swap_params: SwapParams = SwapParams {
            in_amount: 1,
            source_mint: manifest_market.get_base_mint(),
            destination_mint: manifest_market.get_quote_mint(),
            source_token_account: Pubkey::new_unique(),
            destination_token_account: Pubkey::new_unique(),
            token_transfer_authority: trader_key,
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
            token_transfer_authority: trader_key,
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
    }
}
