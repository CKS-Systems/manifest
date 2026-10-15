#![cfg(feature = "test-sbf")]

#[path = "../../../programs/manifest/tests/program_test/fixtures.rs"]
// Shared fixtures serialize access through a single-threaded Rc context.
#[allow(dead_code, unused_imports, clippy::await_holding_refcell_ref)]
mod fixtures;

use std::{cell::RefCell, collections::HashMap, rc::Rc};

use anyhow::{ensure, Context};
use base64::{engine::general_purpose::STANDARD, Engine};
use fixtures::{send_tx_with_retry, MarketFixture, MintFixture, TokenAccountFixture};
use manifest::{
    program::{
        batch_update::PlaceOrderParams, batch_update_instruction,
        claim_seat_instruction::claim_seat_instruction, deposit_instruction, swap_instruction,
    },
    quantities::{BaseAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{OrderType, NO_EXPIRATION_LAST_VALID_SLOT},
    validation::get_vault_address,
};
use manifest_okx::{mfx::Manifest, Dex, PoolMetadataValue, SwapDirection};
use solana_account::Account;
use solana_client::{rpc_client::RpcClient, rpc_request::RpcRequest};
use solana_keypair::Keypair;
use solana_program_test::ProgramTest;
use solana_signer::Signer;
use solana_transaction::Transaction;

fn manifest_program_test() -> ProgramTest {
    ProgramTest::new("manifest", manifest::ID, None)
}

struct Case {
    bid: bool,
    decimals: (u8, u8),
    orders: Vec<(u64, u32, i8)>,
    input: u64,
    output: u64,
    quote_atoms: u64,
    spent: u64,
}

async fn check(case: Case) -> anyhow::Result<()> {
    let maker = Keypair::new();
    let mut program = manifest_program_test();
    program.add_account(
        maker.pubkey(),
        Account::new(1_000_000_000, 0, &solana_sdk_ids::system_program::id()),
    );
    let context = Rc::new(RefCell::new(program.start_with_context().await));
    let payer = context.borrow().payer.insecure_clone();
    let banks = context.borrow().banks_client.clone();
    let mut base = MintFixture::new(Rc::clone(&context), Some(case.decimals.0)).await;
    let mut quote = MintFixture::new(Rc::clone(&context), Some(case.decimals.1)).await;
    let market = MarketFixture::new(Rc::clone(&context), &base.key, &quote.key).await;
    let trader_base =
        TokenAccountFixture::new(Rc::clone(&context), &base.key, &payer.pubkey()).await;
    let trader_quote =
        TokenAccountFixture::new(Rc::clone(&context), &quote.key, &payer.pubkey()).await;
    let maker_base =
        TokenAccountFixture::new(Rc::clone(&context), &base.key, &maker.pubkey()).await;
    let maker_quote =
        TokenAccountFixture::new(Rc::clone(&context), &quote.key, &maker.pubkey()).await;
    send_tx_with_retry(
        Rc::clone(&context),
        &[claim_seat_instruction(&market.key, &maker.pubkey())],
        Some(&maker.pubkey()),
        &[&maker],
    )
    .await?;
    let funding = case.orders.iter().try_fold(
        0_u64,
        |total, &(size, mantissa, exponent)| -> anyhow::Result<u64> {
            let amount = if case.bid {
                QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(mantissa, exponent)
                    .map_err(|error| anyhow::anyhow!("invalid test price: {error:?}"))?
                    .checked_quote_for_base(BaseAtoms::new(size), true)?
                    .as_u64()
            } else {
                size
            };
            total.checked_add(amount).context("test funding overflow")
        },
    )?;
    let (funding_mint, funding_account) = if case.bid {
        quote.mint_to(&maker_quote.key, funding).await;
        (quote.key, maker_quote.key)
    } else {
        base.mint_to(&maker_base.key, funding).await;
        (base.key, maker_base.key)
    };
    send_tx_with_retry(
        Rc::clone(&context),
        &[deposit_instruction(
            &market.key,
            &maker.pubkey(),
            &funding_mint,
            funding,
            &funding_account,
            spl_token::id(),
            None,
        )],
        Some(&maker.pubkey()),
        &[&maker],
    )
    .await?;
    let orders = case
        .orders
        .iter()
        .map(|&(size, mantissa, exponent)| {
            PlaceOrderParams::new(
                size,
                mantissa,
                exponent,
                case.bid,
                OrderType::Limit,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )
        })
        .collect();
    send_tx_with_retry(
        Rc::clone(&context),
        &[batch_update_instruction(
            &market.key,
            &maker.pubkey(),
            None,
            vec![],
            orders,
            None,
            None,
            None,
            None,
        )],
        Some(&maker.pubkey()),
        &[&maker],
    )
    .await?;
    if case.bid {
        base.mint_to(&trader_base.key, case.input).await;
    } else {
        quote.mint_to(&trader_quote.key, case.input).await;
    }

    let market_account = banks.get_account(market.key).await?.unwrap();
    let mocks = HashMap::from([(
        RpcRequest::GetAccountInfo,
        serde_json::json!({
            "context":{"slot":1},"value":{
                "lamports":market_account.lamports,"owner":market_account.owner.to_string(),
                "executable":false,"rentEpoch":0,"space":market_account.data.len(),
                "data":[STANDARD.encode(&market_account.data),"base64"]
            }
        }),
    )]);
    let market_key = market.key.to_string();
    let metadata = tokio::task::spawn_blocking(move || {
        Manifest.fetch_pool_metadata(
            &RpcClient::new_mock_with_mocks("succeeds", mocks),
            &market_key,
        )
    })
    .await?
    .unwrap();
    let input_scale = 10_u64.pow(if case.bid {
        case.decimals.0
    } else {
        case.decimals.1
    } as u32);
    let output_scale = 10_u64.pow(if case.bid {
        case.decimals.1
    } else {
        case.decimals.0
    } as u32);
    let direction = if case.bid {
        SwapDirection::BaseToQuote
    } else {
        SwapDirection::QuoteToBase
    };
    let output = Manifest.quote(case.input as f64 / input_scale as f64, &metadata, direction);
    assert_eq!(output, case.quote_atoms as f64 / output_scale as f64);
    let Some(PoolMetadataValue::Array(levels)) =
        metadata.extra.get(if case.bid { "bids" } else { "asks" })
    else {
        panic!("missing book")
    };
    assert_eq!(levels.len(), case.orders.len());
    assert!(levels
        .iter()
        .all(|level| matches!(level, PoolMetadataValue::Array(fields) if fields.len()==4)));
    // Keep the f64 adapter's execution bound below u64::MAX for huge outputs.
    // This 50 bps test policy is not an execution guarantee from the adapter.
    let estimate = output * output_scale as f64;
    let bound = (estimate
        * if estimate > (1_u64 << 53) as f64 {
            0.995
        } else {
            1.0
        })
    .floor();
    ensure!(bound >= 0.0 && bound < u64::MAX as f64);
    let instruction = swap_instruction(
        &market.key,
        &payer.pubkey(),
        &base.key,
        &quote.key,
        &trader_base.key,
        &trader_quote.key,
        case.input,
        bound as u64,
        case.bid,
        true,
        spl_token::id(),
        spl_token::id(),
        false,
    );
    let hash = banks.get_latest_blockhash().await?;
    let tx =
        Transaction::new_signed_with_payer(&[instruction], Some(&payer.pubkey()), &[&payer], hash);
    let tracked = [
        market.key,
        trader_base.key,
        trader_quote.key,
        get_vault_address(&market.key, &base.key).0,
        get_vault_address(&market.key, &quote.key).0,
    ];
    let mut before = Vec::new();
    for key in tracked {
        before.push(banks.get_account(key).await?);
    }
    let simulation = banks.simulate_transaction(tx.clone()).await?;
    assert_eq!(simulation.result, Some(Ok(())));
    let details = simulation.simulation_details.unwrap();
    assert!(details.units_consumed > 0);
    assert!(details
        .logs
        .iter()
        .any(|line| line.contains(&format!("Program {} invoke [2]", spl_token::id()))));
    for (key, expected) in tracked.iter().zip(before) {
        assert_eq!(banks.get_account(*key).await?, expected);
    }
    banks.process_transaction(tx).await?;
    let (input_left, actual_output) = if case.bid {
        (
            trader_base.balance_atoms().await,
            trader_quote.balance_atoms().await,
        )
    } else {
        (
            trader_quote.balance_atoms().await,
            trader_base.balance_atoms().await,
        )
    };
    assert_eq!(actual_output, case.output);
    assert_eq!(case.input - input_left, case.spent);
    Ok(())
}

#[tokio::test]
async fn fetched_quotes_match_sbf_regressions() -> anyhow::Result<()> {
    for (bid, decimals, orders, input, output, spent) in [
        (false, (0, 0), vec![(2, 4, 0)], 1, 0, 0),
        (true, (0, 0), vec![(u64::MAX / 2, 2, 0)], 1, 2, 1),
        (false, (0, 0), vec![(u64::MAX - 1, 5, -1)], 1, 2, 1),
        (
            true,
            (0, 0),
            vec![(1_000_000_000_000_000_000, 22, -18)],
            863_636_363_636_363_648,
            19,
            863_636_363_636_363_648,
        ),
        (
            true,
            (18, 0),
            vec![(u64::MAX, 1, -18)],
            1_000_000_000_000_000_000,
            1,
            1_000_000_000_000_000_000,
        ),
        (
            true,
            (18, 18),
            vec![(3_074_457_345_618_258_602, 3, 0); 2],
            7_000_000_000_000_000_000,
            u64::MAX - 3,
            6_148_914_691_236_517_204,
        ),
        (
            false,
            (18, 0),
            vec![(u64::MAX / 2, 1, -18); 2],
            20,
            u64::MAX - 1,
            18,
        ),
    ] {
        check(Case {
            bid,
            decimals,
            orders,
            input,
            output,
            quote_atoms: output,
            spent,
        })
        .await?;
    }
    Ok(())
}

#[tokio::test]
async fn indicative_quote_retains_documented_rounding_difference() -> anyhow::Result<()> {
    check(Case {
        bid: false,
        decimals: (0, 0),
        orders: vec![(3, 15, -1)],
        input: 3,
        output: 2,
        quote_atoms: 1,
        spent: 3,
    })
    .await
}
