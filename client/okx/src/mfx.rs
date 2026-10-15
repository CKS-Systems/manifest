use async_trait::async_trait;
use hypertree::{
    hypertree::{HyperTreeReadOperations, HyperTreeValueIteratorTrait},
    validate_red_black_tree,
};
use log::error;
use manifest::{
    quantities::WrapperU64,
    state::{MarketValue, RestingOrder, MARKET_FIXED_DISCRIMINANT},
};
use solana_account_decoder::UiAccountEncoding;
use solana_client::{
    rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_program::pubkey::Pubkey;
use std::{collections::HashMap, error::Error, str::FromStr};
use tokio::sync::mpsc::Sender;

use super::{get_extra, Dex, PoolMetadata, PoolMetadataValue, SwapDirection};

pub struct Manifest;

#[async_trait]
impl Dex for Manifest {
    fn dex_name(&self) -> String {
        "Manifest".to_string()
    }

    fn dex_program_id(&self) -> Pubkey {
        manifest::ID
    }

    /// Indicative exact-input quote in token units, rounded down to output atoms.
    /// Input is rounded down to whole input atoms. Invalid or out-of-range
    /// amounts return zero.
    /// Metadata contains rounded order totals rather than original prices, so
    /// this does not reproduce all of Core's per-fill rounding rules. Re-quote
    /// against Core or simulate before using the result as an execution bound.
    /// The f64 interface and metadata can also lose precision for large amounts.
    fn quote(&self, amount_in: f64, metadata: &PoolMetadata, direction: SwapDirection) -> f64 {
        if amount_in <= 0.0 {
            return 0.0;
        }

        let book_key: &str = match direction {
            SwapDirection::BaseToQuote => "bids",
            SwapDirection::QuoteToBase => "asks",
        };
        let levels: Vec<PoolMetadataValue> =
            get_extra!(metadata, book_key, PoolMetadataValue::Array).unwrap_or_default();
        let base_decimals: f64 =
            get_extra!(metadata, "base_decimals", PoolMetadataValue::Number).unwrap_or(6.0_f64);
        let quote_decimals: f64 =
            get_extra!(metadata, "quote_decimals", PoolMetadataValue::Number).unwrap_or(6.0_f64);
        // Metadata is untrusted: bound exponents before integer pow and reject
        // NaN/fractional values that would otherwise truncate during casting.
        let decimal_scale = |decimals: f64| -> Option<u64> {
            if !decimals.is_finite() || decimals.fract() != 0.0 || !(0.0..=19.0).contains(&decimals)
            {
                return None;
            }
            10_u64.checked_pow(decimals as u32)
        };
        let Some(base_scale) = decimal_scale(base_decimals) else {
            return 0.0;
        };
        let Some(quote_scale) = decimal_scale(quote_decimals) else {
            return 0.0;
        };
        let (input_decimals, output_scale) = match direction {
            SwapDirection::BaseToQuote => (base_decimals, quote_scale),
            SwapDirection::QuoteToBase => (quote_decimals, base_scale),
        };
        // Parse the decimal representation instead of multiplying f64 tokens:
        // e.g. 0.29 * 100 is slightly below 29 and would truncate to 28 atoms.
        let mut input_amount = amount_in.to_string();
        if let Some(point) = input_amount.find('.') {
            input_amount.truncate(point + 1 + input_decimals as usize);
        }
        let Ok(mut remaining_in_atoms) =
            spl_token::try_ui_amount_into_amount(input_amount, input_decimals as u8)
        else {
            return 0.0;
        };
        let mut total_out_atoms: u64 = 0;
        // Canonical numeric metadata rounds the highest valid u64 counts to
        // 2^64. Accept that rounded boundary; the cast saturates it to u64::MAX.
        // Values above it cannot come from a u64 count and remain invalid.
        let atom_count = |value: &PoolMetadataValue| -> Option<u64> {
            match value {
                PoolMetadataValue::Number(atoms)
                    if atoms.is_finite()
                        && *atoms >= 0.0
                        && atoms.fract() == 0.0
                        && *atoms <= u64::MAX as f64 =>
                {
                    Some(*atoms as u64)
                }
                _ => None,
            }
        };

        for level in levels.into_iter() {
            match level {
                PoolMetadataValue::Array(level_values) => {
                    if level_values.len() < 2 {
                        continue;
                    }
                    let (Some(base_atoms), Some(quote_atoms)) =
                        (atom_count(&level_values[0]), atom_count(&level_values[1]))
                    else {
                        continue;
                    };
                    if base_atoms == 0 {
                        continue;
                    }

                    let (level_input_atoms, level_output_atoms) = match direction {
                        SwapDirection::BaseToQuote => (base_atoms, quote_atoms),
                        SwapDirection::QuoteToBase => (quote_atoms, base_atoms),
                    };
                    if level_input_atoms == 0 {
                        continue;
                    }

                    let filled_input_atoms = remaining_in_atoms.min(level_input_atoms);
                    // A u64-by-u64 product fits in u128. The quotient cannot
                    // exceed level_output_atoms, so narrowing back to u64 is safe.
                    let filled_output_atoms =
                        (u128::from(filled_input_atoms) * u128::from(level_output_atoms)
                            / u128::from(level_input_atoms)) as u64;
                    let Some(next_total) = total_out_atoms.checked_add(filled_output_atoms) else {
                        return 0.0;
                    };
                    total_out_atoms = next_total;
                    remaining_in_atoms -= filled_input_atoms;
                    if remaining_in_atoms == 0 {
                        break;
                    }
                }
                _ => {}
            }
        }

        // Fall through in case we exhaust the book and do not fully fill.
        total_out_atoms as f64 / output_scale as f64
    }

    fn fetch_pool_addresses(&self, client: &RpcClient) -> Vec<String> {
        let accounts = match client.get_program_ui_accounts_with_config(
            &manifest::id().to_bytes().into(),
            RpcProgramAccountsConfig {
                filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                    0,
                    MARKET_FIXED_DISCRIMINANT.to_le_bytes().into(),
                ))]),
                account_config: RpcAccountInfoConfig {
                    encoding: Some(UiAccountEncoding::Base64),
                    ..RpcAccountInfoConfig::default()
                },
                ..RpcProgramAccountsConfig::default()
            },
        ) {
            Ok(accs) => accs,
            Err(e) => {
                error!(
                    "Failed to fetch {} market addresses: {}",
                    self.dex_name(),
                    e
                );
                return Vec::new();
            }
        };
        accounts
            .into_iter()
            .map(|(pk, _acct)| pk.to_string())
            .collect()
    }

    async fn listen_new_pool_addresses(
        &self,
        _client: &RpcClient,
        _address_tx: Sender<String>,
    ) -> Result<(), Box<dyn Error>> {
        // To implement this, if you want to watch all ix on chain for Manifest
        // and find new inits, look for the first by of call data to the
        // manifest ix to be 0x0
        // (https://github.com/Bonasa-Tech/manifest/blob/93d78d5ca60ac7d9ea282f7d57ec5ea61f13de48/programs/manifest/src/program/instruction.rs#L20)

        Ok(())
    }

    fn fetch_pool_metadata(&self, client: &RpcClient, pool_address: &str) -> Option<PoolMetadata> {
        let market_account = client
            .get_account(&Pubkey::from_str(pool_address).ok()?)
            .ok()?;
        if market_account.owner != manifest::ID {
            return None;
        }
        let market_data = market_account.data;
        let market: MarketValue =
            manifest::program::get_dynamic_value_or(market_data.as_slice()).ok()?;
        if market.fixed.discriminant != MARKET_FIXED_DISCRIMINANT {
            return None;
        }
        let bids = market.get_bids();
        let asks = market.get_asks();
        // Validate RPC-sourced links before the zero-copy iterator follows them.
        validate_red_black_tree::<RestingOrder>(
            &market.dynamic,
            bids.get_root_index(),
            bids.get_max_index(),
        )
        .ok()?;
        validate_red_black_tree::<RestingOrder>(
            &market.dynamic,
            asks.get_root_index(),
            asks.get_max_index(),
        )
        .ok()?;
        let base_vault: &Pubkey = market.fixed.get_base_vault();
        let quote_vault: &Pubkey = market.fixed.get_quote_vault();

        let base_reserve: Option<f64> = match client.get_token_account_balance(base_vault) {
            Ok(resp) => Some(resp.ui_amount.unwrap_or(0.0)),
            Err(_) => None,
        };
        let quote_reserve: Option<f64> = match client.get_token_account_balance(quote_vault) {
            Ok(resp) => Some(resp.ui_amount.unwrap_or(0.0)),
            Err(_) => None,
        };

        let mut extra = HashMap::new();
        let base_mint_decimals: u8 = market.fixed.get_base_mint_decimals();
        extra.insert(
            "base_decimals".to_string(),
            PoolMetadataValue::Number(base_mint_decimals as f64),
        );
        extra.insert(
            "quote_decimals".to_string(),
            PoolMetadataValue::Number(market.fixed.get_quote_mint_decimals() as f64),
        );

        // Bids is an array of arrays. Top of book is first. Similar for asks.
        // [ [baseAtoms1, quoteAtoms1], [baseAtoms2, quoteAtoms2], [baseAtoms3, quoteAtoms3], ...]
        let bids_vec: Vec<PoolMetadataValue> = bids
            .iter::<RestingOrder>()
            .map(|(_ind, resting_order)| {
                let bid = resting_order;
                PoolMetadataValue::Array(vec![
                    PoolMetadataValue::Number(bid.get_num_base_atoms().as_u64() as f64),
                    PoolMetadataValue::Number(
                        bid.get_price()
                            .checked_quote_for_base(bid.get_num_base_atoms(), true)
                            .unwrap_or_default()
                            .as_u64() as f64,
                    ),
                ])
            })
            .collect::<Vec<PoolMetadataValue>>();
        extra.insert("bids".to_string(), PoolMetadataValue::Array(bids_vec));

        let asks_vec: Vec<PoolMetadataValue> = asks
            .iter::<RestingOrder>()
            .map(|(_ind, resting_order)| {
                let ask = resting_order;
                PoolMetadataValue::Array(vec![
                    PoolMetadataValue::Number(ask.get_num_base_atoms().as_u64() as f64),
                    PoolMetadataValue::Number(
                        ask.get_price()
                            .checked_quote_for_base(ask.get_num_base_atoms(), true)
                            .unwrap_or_default()
                            .as_u64() as f64,
                    ),
                ])
            })
            .collect::<Vec<PoolMetadataValue>>();
        extra.insert("asks".to_string(), PoolMetadataValue::Array(asks_vec));

        Some(PoolMetadata {
            pool_address: pool_address.to_string(),
            base_mint: market.get_base_mint().to_string(),
            quote_mint: market.get_quote_mint().to_string(),
            base_reserve,
            quote_reserve,
            trade_fee: Some(0.0_f64),
            extra,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata() -> PoolMetadata {
        let mut extra: HashMap<String, PoolMetadataValue> = HashMap::new();
        extra.insert(
            "base_decimals".to_string(),
            PoolMetadataValue::Number(0.0_f64),
        );
        extra.insert(
            "quote_decimals".to_string(),
            PoolMetadataValue::Number(0.0_f64),
        );
        extra.insert(
            "bids".to_string(),
            PoolMetadataValue::Array(vec![PoolMetadataValue::Array(vec![
                PoolMetadataValue::Number(2.0_f64),
                PoolMetadataValue::Number(6.0_f64),
            ])]),
        );
        extra.insert(
            "asks".to_string(),
            PoolMetadataValue::Array(vec![PoolMetadataValue::Array(vec![
                PoolMetadataValue::Number(2.0_f64),
                PoolMetadataValue::Number(8.0_f64),
            ])]),
        );
        PoolMetadata {
            pool_address: String::new(),
            base_mint: String::new(),
            quote_mint: String::new(),
            base_reserve: None,
            quote_reserve: None,
            trade_fee: None,
            extra,
        }
    }

    #[test]
    fn quote_uses_bids_for_base_input() {
        let output: f64 = Manifest.quote(1.0_f64, &metadata(), SwapDirection::BaseToQuote);
        assert_eq!(output, 3.0_f64);
    }

    #[test]
    fn quote_uses_asks_for_quote_input() {
        let output: f64 = Manifest.quote(4.0_f64, &metadata(), SwapDirection::QuoteToBase);
        assert_eq!(output, 1.0_f64);
    }

    #[test]
    fn quote_rounds_partial_base_output_to_atoms() {
        use manifest::quantities::{QuoteAtoms, QuoteAtomsPerBaseAtom};

        let price = QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(4, 0).unwrap();
        for input_atoms in [1, 4, 8] {
            let expected = price
                .checked_base_for_quote(QuoteAtoms::new(input_atoms), false)
                .unwrap()
                .as_u64();
            assert_eq!(
                Manifest.quote(input_atoms as f64, &metadata(), SwapDirection::QuoteToBase),
                expected as f64,
            );
        }
    }

    #[test]
    fn quote_rounds_partial_quote_output_to_atoms() {
        let mut metadata = metadata();
        metadata.extra.insert(
            "bids".to_string(),
            PoolMetadataValue::Array(vec![PoolMetadataValue::Array(vec![
                PoolMetadataValue::Number(8.0),
                PoolMetadataValue::Number(2.0),
            ])]),
        );

        for (input, expected) in [(1.0, 0.0), (4.0, 1.0), (8.0, 2.0)] {
            assert_eq!(
                Manifest.quote(input, &metadata, SwapDirection::BaseToQuote),
                expected,
            );
        }
    }

    #[test]
    fn quote_uses_output_mint_decimals_for_rounding() {
        let mut metadata = metadata();
        metadata
            .extra
            .insert("base_decimals".to_string(), PoolMetadataValue::Number(2.0));
        metadata
            .extra
            .insert("quote_decimals".to_string(), PoolMetadataValue::Number(3.0));

        for (input, expected) in [(0.001, 0.0), (0.004, 0.01), (0.008, 0.02)] {
            assert_eq!(
                Manifest.quote(input, &metadata, SwapDirection::QuoteToBase),
                expected,
            );
        }

        metadata.extra.insert(
            "bids".to_string(),
            PoolMetadataValue::Array(vec![PoolMetadataValue::Array(vec![
                PoolMetadataValue::Number(8.0),
                PoolMetadataValue::Number(2.0),
            ])]),
        );
        for (input, expected) in [(0.01, 0.0), (0.04, 0.001), (0.08, 0.002)] {
            assert_eq!(
                Manifest.quote(input, &metadata, SwapDirection::BaseToQuote),
                expected,
            );
        }
    }

    #[test]
    fn quote_preserves_full_levels_before_rounding_partial_output() {
        let mut metadata = metadata();
        let Some(PoolMetadataValue::Array(asks)) = metadata.extra.get_mut("asks") else {
            panic!("missing asks");
        };
        asks.push(PoolMetadataValue::Array(vec![
            PoolMetadataValue::Number(3.0),
            PoolMetadataValue::Number(15.0),
        ]));

        for (input, expected) in [(9.0, 2.0), (13.0, 3.0), (30.0, 5.0)] {
            assert_eq!(
                Manifest.quote(input, &metadata, SwapDirection::QuoteToBase),
                expected,
            );
        }
    }

    #[test]
    fn quote_preserves_full_fills_with_fractional_token_amounts() {
        let mut metadata = metadata();
        for key in ["base_decimals", "quote_decimals"] {
            metadata
                .extra
                .insert(key.to_string(), PoolMetadataValue::Number(2.0));
        }
        metadata.extra.insert(
            "bids".to_string(),
            PoolMetadataValue::Array(vec![PoolMetadataValue::Array(vec![
                PoolMetadataValue::Number(29.0),
                PoolMetadataValue::Number(87.0),
            ])]),
        );

        assert_eq!(
            Manifest.quote(0.29, &metadata, SwapDirection::BaseToQuote),
            0.87,
        );
    }

    #[test]
    fn quote_preserves_integer_partial_fills() {
        let mut metadata = metadata();
        for key in ["bids", "asks"] {
            metadata.extra.insert(
                key.to_string(),
                PoolMetadataValue::Array(vec![PoolMetadataValue::Array(vec![
                    PoolMetadataValue::Number(22.0),
                    PoolMetadataValue::Number(22.0),
                ])]),
            );
        }

        for direction in [SwapDirection::BaseToQuote, SwapDirection::QuoteToBase] {
            assert_eq!(Manifest.quote(15.0, &metadata, direction), 15.0);
        }
    }

    #[test]
    fn quote_preserves_decimal_input_across_levels() {
        let mut metadata = metadata();
        metadata
            .extra
            .insert("quote_decimals".to_string(), PoolMetadataValue::Number(2.0));
        let level = PoolMetadataValue::Array(vec![
            PoolMetadataValue::Number(1.0),
            PoolMetadataValue::Number(29.0),
        ]);
        metadata.extra.insert(
            "asks".to_string(),
            PoolMetadataValue::Array(vec![level.clone(), level]),
        );

        assert_eq!(
            Manifest.quote(0.58, &metadata, SwapDirection::QuoteToBase),
            2.0,
        );
    }

    #[test]
    fn quote_handles_products_larger_than_u64() {
        let mut metadata = metadata();
        for key in ["bids", "asks"] {
            metadata.extra.insert(
                key.to_string(),
                PoolMetadataValue::Array(vec![PoolMetadataValue::Array(vec![
                    PoolMetadataValue::Number(1_000_000_000_000.0),
                    PoolMetadataValue::Number(1_000_000_000_000.0),
                ])]),
            );
        }

        for direction in [SwapDirection::BaseToQuote, SwapDirection::QuoteToBase] {
            assert_eq!(
                Manifest.quote(500_000_000_000.0, &metadata, direction),
                500_000_000_000.0,
            );
        }
    }

    #[test]
    fn quote_rejects_inputs_that_cannot_represent_atomic_amounts() {
        for input in [0.5, f64::NAN, f64::INFINITY, -1.0, u64::MAX as f64] {
            for direction in [SwapDirection::BaseToQuote, SwapDirection::QuoteToBase] {
                assert_eq!(Manifest.quote(input, &metadata(), direction), 0.0);
            }
        }
    }

    #[test]
    fn quote_rounds_input_down_to_whole_atoms() {
        assert_eq!(
            Manifest.quote(1.5, &metadata(), SwapDirection::BaseToQuote),
            3.0,
        );
        assert_eq!(
            Manifest.quote(4.5, &metadata(), SwapDirection::QuoteToBase),
            1.0,
        );
    }

    #[test]
    fn quote_accepts_atomic_inputs_at_each_supported_decimal_scale() {
        for decimals in 0..=19 {
            let mut metadata = metadata();
            metadata.extra.insert(
                "quote_decimals".to_string(),
                PoolMetadataValue::Number(decimals as f64),
            );
            assert_eq!(
                Manifest.quote(
                    4.0 / 10_u64.pow(decimals) as f64,
                    &metadata,
                    SwapDirection::QuoteToBase,
                ),
                1.0,
                "quote decimals: {decimals}",
            );
        }
    }

    #[test]
    fn quote_skips_invalid_metadata_atom_counts() {
        let above_rounded_max = f64::from_bits((u64::MAX as f64).to_bits() + 1);
        for invalid in [0.5, f64::NAN, f64::INFINITY, -1.0, above_rounded_max] {
            for index in [0, 1] {
                let mut metadata = metadata();
                let mut level = vec![
                    PoolMetadataValue::Number(2.0),
                    PoolMetadataValue::Number(6.0),
                ];
                level[index] = PoolMetadataValue::Number(invalid);
                metadata.extra.insert(
                    "bids".to_string(),
                    PoolMetadataValue::Array(vec![PoolMetadataValue::Array(level)]),
                );
                assert_eq!(
                    Manifest.quote(1.0, &metadata, SwapDirection::BaseToQuote),
                    0.0,
                );
            }
        }
    }

    #[test]
    fn quote_keeps_orders_at_the_rounded_u64_metadata_boundary() {
        for amount in [u64::MAX - 2047, u64::MAX - 1024, u64::MAX - 1023, u64::MAX] {
            let mut metadata = metadata();
            for key in ["bids", "asks"] {
                metadata.extra.insert(
                    key.to_string(),
                    PoolMetadataValue::Array(vec![PoolMetadataValue::Array(vec![
                        PoolMetadataValue::Number(amount as f64),
                        PoolMetadataValue::Number(amount as f64),
                    ])]),
                );
            }
            for direction in [SwapDirection::BaseToQuote, SwapDirection::QuoteToBase] {
                assert_eq!(Manifest.quote(1.0, &metadata, direction), 1.0);
            }
        }
    }

    #[test]
    fn quote_keeps_a_valid_maximum_size_bid_from_core_metadata() {
        use manifest::{
            quantities::{BaseAtoms, QuoteAtomsPerBaseAtom},
            state::{
                AddOrderToMarketArgs, MarketFixed, OrderType, MARKET_BLOCK_SIZE,
                NO_EXPIRATION_LAST_VALID_SLOT,
            },
        };

        let market_key = Pubkey::new_unique();
        let mut market = MarketValue {
            fixed: MarketFixed::new_empty_from_mint_parts(
                &Pubkey::new_unique(),
                18,
                &Pubkey::new_unique(),
                0,
                Pubkey::new_unique(),
                0,
                Pubkey::new_unique(),
                0,
            ),
            dynamic: vec![0; MARKET_BLOCK_SIZE * 4],
        };
        market.market_expand_n(4).unwrap();
        let maker = Pubkey::new_unique();
        let taker = Pubkey::new_unique();
        market.claim_seat(&maker).unwrap();
        market.claim_seat(&taker).unwrap();
        let maker_index = market.get_trader_index(&maker);
        let taker_index = market.get_trader_index(&taker);
        market.deposit(maker_index, 19, false).unwrap();
        market
            .deposit(taker_index, 1_000_000_000_000_000_000, true)
            .unwrap();
        market
            .place_order(AddOrderToMarketArgs {
                market: &market_key,
                trader_index: maker_index,
                num_base_atoms: BaseAtoms::new(u64::MAX),
                price: QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(1, -18).unwrap(),
                is_bid: true,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: Some(100),
            })
            .unwrap();

        // Use the same rounded numeric metadata that fetch_pool_metadata emits.
        let mut metadata = metadata();
        metadata
            .extra
            .insert("base_decimals".to_string(), PoolMetadataValue::Number(18.0));
        metadata.extra.insert(
            "bids".to_string(),
            PoolMetadataValue::Array(
                market
                    .get_bids()
                    .iter::<RestingOrder>()
                    .map(|(_, order)| {
                        PoolMetadataValue::Array(vec![
                            PoolMetadataValue::Number(order.get_num_base_atoms().as_u64() as f64),
                            PoolMetadataValue::Number(
                                order
                                    .get_price()
                                    .checked_quote_for_base(order.get_num_base_atoms(), true)
                                    .unwrap()
                                    .as_u64() as f64,
                            ),
                        ])
                    })
                    .collect(),
            ),
        );
        let core_output = market
            .impact_quote_atoms_with_slot(
                false,
                BaseAtoms::new(1_000_000_000_000_000_000),
                &[None, None],
                100,
            )
            .unwrap()
            .as_u64();
        assert_eq!(core_output, 1);
        assert_eq!(
            Manifest.quote(1.0, &metadata, SwapDirection::BaseToQuote),
            core_output as f64,
        );

        let fill = market
            .place_order(AddOrderToMarketArgs {
                market: &market_key,
                trader_index: taker_index,
                num_base_atoms: BaseAtoms::new(1_000_000_000_000_000_000),
                price: QuoteAtomsPerBaseAtom::ZERO,
                is_bid: false,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::ImmediateOrCancel,
                global_trade_accounts_opts: &[None, None],
                current_slot: Some(100),
            })
            .unwrap();
        assert_eq!(fill.quote_atoms_traded.as_u64(), core_output);
    }

    #[test]
    fn quote_rejects_output_atom_overflow() {
        let mut metadata = metadata();
        let level = PoolMetadataValue::Array(vec![
            PoolMetadataValue::Number(1.0),
            PoolMetadataValue::Number(10_000_000_000_000_000_000.0),
        ]);
        metadata.extra.insert(
            "bids".to_string(),
            PoolMetadataValue::Array(vec![level.clone(), level]),
        );

        assert_eq!(
            Manifest.quote(2.0, &metadata, SwapDirection::BaseToQuote),
            0.0,
        );
    }
}
