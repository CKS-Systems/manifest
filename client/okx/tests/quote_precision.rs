use std::collections::HashMap;

use hypertree::hypertree::HyperTreeValueIteratorTrait;
use manifest::{
    quantities::{BaseAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{
        AddOrderToMarketArgs, MarketFixed, MarketValue, OrderType, RestingOrder, MARKET_BLOCK_SIZE,
        NO_EXPIRATION_LAST_VALID_SLOT,
    },
};
use manifest_okx::{mfx::Manifest, Dex, PoolMetadata, PoolMetadataValue as Value, SwapDirection};
use solana_program::pubkey::Pubkey;

fn check_quote(
    bid: bool,
    decimals: (u8, u8),
    orders: &[(u64, u32, i8)],
    input: u64,
    expected_output: u64,
) {
    let key = Pubkey::new_unique();
    let mut market = MarketValue {
        fixed: MarketFixed::new_empty_from_mint_parts(
            &Pubkey::new_unique(),
            decimals.0,
            &Pubkey::new_unique(),
            decimals.1,
            Pubkey::new_unique(),
            0,
            Pubkey::new_unique(),
            0,
        ),
        dynamic: vec![0; MARKET_BLOCK_SIZE * 8],
    };
    market.market_expand_n(8).unwrap();
    let maker = Pubkey::new_unique();
    let taker = Pubkey::new_unique();
    market.claim_seat(&maker).unwrap();
    market.claim_seat(&taker).unwrap();
    let maker_index = market.get_trader_index(&maker);
    let taker_index = market.get_trader_index(&taker);
    for &(size, mantissa, exponent) in orders {
        let price =
            QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(mantissa, exponent).unwrap();
        let funding = if bid {
            price
                .checked_quote_for_base(BaseAtoms::new(size), true)
                .unwrap()
                .as_u64()
        } else {
            size
        };
        market.deposit(maker_index, funding, !bid).unwrap();
        market
            .place_order(AddOrderToMarketArgs {
                market: &key,
                trader_index: maker_index,
                num_base_atoms: BaseAtoms::new(size),
                price,
                is_bid: bid,
                last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: Some(100),
            })
            .unwrap();
    }
    market.deposit(taker_index, input, bid).unwrap();
    let core_output = if bid {
        market
            .impact_quote_atoms_with_slot(false, BaseAtoms::new(input), &[None, None], 100)
            .unwrap()
            .as_u64()
    } else {
        market
            .impact_base_atoms_with_slot(true, QuoteAtoms::new(input), &[None, None], 100)
            .unwrap()
            .as_u64()
    };
    assert_eq!(core_output, expected_output);
    let book = if bid {
        market.get_bids()
    } else {
        market.get_asks()
    };
    let counts: Vec<_> = book
        .iter::<RestingOrder>()
        .map(|(_, order)| {
            (
                order.get_num_base_atoms().as_u64(),
                order
                    .get_price()
                    .checked_quote_for_base(order.get_num_base_atoms(), true)
                    .unwrap()
                    .as_u64(),
            )
        })
        .collect();
    let (input_decimals, output_decimals, direction, book_key) = if bid {
        (decimals.0, decimals.1, SwapDirection::BaseToQuote, "bids")
    } else {
        (decimals.1, decimals.0, SwapDirection::QuoteToBase, "asks")
    };
    for exact in [false, true] {
        let levels = counts
            .iter()
            .map(|&(base, quote)| {
                let mut fields = vec![Value::Number(base as f64), Value::Number(quote as f64)];
                if exact {
                    fields.extend([
                        Value::String(base.to_string()),
                        Value::String(quote.to_string()),
                    ]);
                }
                Value::Array(fields)
            })
            .collect();
        let metadata = PoolMetadata {
            pool_address: key.to_string(),
            base_mint: String::new(),
            quote_mint: String::new(),
            base_reserve: None,
            quote_reserve: None,
            trade_fee: None,
            extra: HashMap::from([
                (
                    "base_decimals".to_string(),
                    Value::Number(decimals.0 as f64),
                ),
                (
                    "quote_decimals".to_string(),
                    Value::Number(decimals.1 as f64),
                ),
                (book_key.to_string(), Value::Array(levels)),
            ]),
        };
        assert_eq!(
            Manifest.quote(
                input as f64 / 10_u64.pow(input_decimals as u32) as f64,
                &metadata,
                direction
            ),
            expected_output as f64 / 10_u64.pow(output_decimals as u32) as f64,
            "exact metadata: {exact}",
        );
    }
    let fill = market
        .place_order(AddOrderToMarketArgs {
            market: &key,
            trader_index: taker_index,
            num_base_atoms: BaseAtoms::new(if bid { input } else { core_output }),
            price: if bid {
                QuoteAtomsPerBaseAtom::ZERO
            } else {
                QuoteAtomsPerBaseAtom::MAX
            },
            is_bid: !bid,
            last_valid_slot: NO_EXPIRATION_LAST_VALID_SLOT,
            order_type: OrderType::ImmediateOrCancel,
            global_trade_accounts_opts: &[None, None],
            current_slot: Some(100),
        })
        .unwrap();
    assert_eq!(
        if bid {
            fill.quote_atoms_traded.as_u64()
        } else {
            fill.base_atoms_traded.as_u64()
        },
        expected_output
    );
}

#[test]
fn maximum_bid_preserves_two_to_one_price() {
    check_quote(true, (0, 0), &[(u64::MAX / 2, 2, 0)], 1, 2);
}

#[test]
fn maximum_ask_preserves_inverse_integer_price() {
    check_quote(false, (0, 0), &[(u64::MAX - 1, 5, -1)], 1, 2);
}

#[test]
fn exact_integral_f64_input_survives_conversion() {
    let input = 863_636_363_636_363_648;
    assert_eq!(input as f64 as u64, input);
    check_quote(
        true,
        (0, 0),
        &[(1_000_000_000_000_000_000, 22, -18)],
        input,
        19,
    );
}

#[test]
fn rounded_bid_totals_do_not_disappear() {
    check_quote(
        true,
        (18, 18),
        &[(3_074_457_345_618_258_602, 3, 0); 2],
        7_000_000_000_000_000_000,
        u64::MAX - 3,
    );
}

#[test]
fn rounded_ask_totals_do_not_disappear() {
    check_quote(
        false,
        (18, 0),
        &[(u64::MAX / 2, 1, -18); 2],
        20,
        u64::MAX - 1,
    );
}
