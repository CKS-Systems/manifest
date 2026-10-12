//! Replays current mainnet accounts through the locally built program: a
//! release must be able to defrag every live market shape and start
//! collecting the advanced-order fee on it.
//!
//! Gated on MAINNET_REPLAY_DIR, a directory of raw `<pubkey>.bin` account
//! snapshots plus a `meta.json` listing each market's vaults, mints and token
//! programs, produced by an off-chain fetch. Without the variable the test is
//! a no-op, so CI needs no fixtures.

use std::{collections::BTreeMap, rc::Rc, str::FromStr};

use crate::{send_tx_with_retry, TestFixture};
use hypertree::{get_helper, HyperTreeValueIteratorTrait, RBNode};
use manifest::{
    program::{
        batch_update::{MarketDataTreeNodeType, PlaceOrderParams},
        batch_update_instruction, claim_seat_instruction, defrag_instruction, deposit_instruction,
        expand_market_instruction, get_dynamic_value_or,
    },
    quantities::WrapperU64,
    state::{
        claimed_seat::ClaimedSeat, MarketValue, OrderType, RestingOrder,
        ADVANCED_ORDER_FEE_LAMPORTS, MARKET_BLOCK_SIZE, NO_EXPIRATION_LAST_VALID_SLOT,
    },
};
use solana_account::{Account, AccountSharedData};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_keypair::Keypair;
use solana_program::{instruction::Instruction, program_pack::Pack, pubkey::Pubkey, rent::Rent};
use solana_program_test::tokio;
use solana_signer::Signer;

fn load(dir: &str, pk: &str) -> Vec<u8> {
    std::fs::read(format!("{dir}/{pk}.bin")).unwrap_or_else(|_| panic!("missing snapshot {pk}"))
}

/// Every resting order as (is_bid, sequence, atoms, owner key): everything
/// defrag must preserve, keyed by owner identity rather than seat index since
/// compaction moves indices.
fn book(market: &MarketValue) -> Vec<(bool, u64, u64, Pubkey)> {
    let mut orders: Vec<(bool, u64, u64, Pubkey)> = Vec::new();
    for is_bid in [true, false] {
        let tree = if is_bid {
            market.get_bids()
        } else {
            market.get_asks()
        };
        for (_, order) in tree.iter::<RestingOrder>() {
            orders.push((
                is_bid,
                order.get_sequence_number(),
                order.get_num_base_atoms().as_u64(),
                *market.get_trader_key_by_index(order.get_trader_index()),
            ));
        }
    }
    orders.sort();
    orders
}

/// Every claimed seat as owner -> (base, quote) withdrawable balances, found
/// by scanning blocks so no tree state is trusted.
fn seats(market: &MarketValue) -> BTreeMap<Pubkey, (u64, u64)> {
    let mut seats: BTreeMap<Pubkey, (u64, u64)> = BTreeMap::new();
    for block in 0..market.dynamic.len() / MARKET_BLOCK_SIZE {
        let index = (block * MARKET_BLOCK_SIZE) as u32;
        let node: &RBNode<ClaimedSeat> = get_helper(&market.dynamic, index);
        if node.get_payload_type() == MarketDataTreeNodeType::ClaimedSeat as u8 {
            let seat: &ClaimedSeat = node.get_value();
            seats.insert(
                seat.trader,
                (
                    seat.base_withdrawable_balance.as_u64(),
                    seat.quote_withdrawable_balance.as_u64(),
                ),
            );
        }
    }
    seats
}

async fn market_account(f: &TestFixture, market: &Pubkey) -> Option<Account> {
    f.try_load(market).await.unwrap()
}

#[tokio::test]
async fn mainnet_replay_defrag_then_collect_advanced_order_fees() -> anyhow::Result<()> {
    let Ok(dir) = std::env::var("MAINNET_REPLAY_DIR") else {
        println!("MAINNET_REPLAY_DIR not set, skipping mainnet replay");
        return Ok(());
    };
    let meta: serde_json::Value =
        serde_json::from_reader(std::fs::File::open(format!("{dir}/meta.json"))?)?;
    let accounts = &meta["accounts"];
    for (market_pk, m) in meta["markets"].as_object().unwrap() {
        println!("=== replaying {market_pk} ({} bytes)", m["len"]);
        replay_market(&dir, market_pk, m, accounts).await?;
    }
    Ok(())
}

async fn replay_market(
    dir: &str,
    market_pk: &str,
    m: &serde_json::Value,
    accounts: &serde_json::Value,
) -> anyhow::Result<()> {
    let f = TestFixture::new().await;
    let market_key = Pubkey::from_str(market_pk)?;
    let key = |field: &str| Pubkey::from_str(m[field].as_str().unwrap()).unwrap();
    let (base_mint, quote_mint) = (key("base_mint"), key("quote_mint"));
    let (base_program, quote_program) = (key("base_token_program"), key("quote_token_program"));

    // The market under the program's ownership, its vaults and mints under
    // their real token programs, all byte-for-byte from mainnet.
    let market_bytes = load(dir, market_pk);
    f.context.borrow_mut().set_account(
        &market_key,
        &AccountSharedData::from(Account {
            lamports: m["lamports"].as_u64().unwrap(),
            data: market_bytes.clone(),
            owner: manifest::id(),
            executable: false,
            rent_epoch: 0,
        }),
    );
    for field in ["base_vault", "quote_vault", "base_mint", "quote_mint"] {
        let pk = m[field].as_str().unwrap();
        let info = &accounts[pk];
        f.context.borrow_mut().set_account(
            &Pubkey::from_str(pk)?,
            &AccountSharedData::from(Account {
                lamports: info["lamports"].as_u64().unwrap(),
                data: load(dir, pk),
                owner: Pubkey::from_str(info["owner"].as_str().unwrap())?,
                executable: false,
                rent_epoch: 0,
            }),
        );
    }
    let collector = Keypair::new_from_array([42; 32]);
    f.context.borrow_mut().set_account(
        &collector.pubkey(),
        &AccountSharedData::from(Account::new(
            1_000_000_000,
            0,
            &solana_sdk_ids::system_program::id(),
        )),
    );

    let before: MarketValue = get_dynamic_value_or(market_bytes.as_slice())?;
    let book_before = book(&before);
    let seats_before = seats(&before);

    // Unbounded runs cap moved seats internally, so repeat until the size is
    // stable. Each run must fit the 1.4M CU transaction ceiling.
    let defrag = defrag_instruction(
        &market_key,
        &collector.pubkey(),
        &base_mint,
        &quote_mint,
        base_program,
        quote_program,
        None,
    );
    let mut previous_len = market_bytes.len();
    let mut closed = false;
    for run in 0..100 {
        send_tx_with_retry(
            Rc::clone(&f.context),
            &[
                ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
                defrag.clone(),
            ],
            Some(&f.payer()),
            &[&f.payer_keypair(), &collector],
        )
        .await?;
        let Some(account) = market_account(&f, &market_key).await else {
            println!("    run {run}: market was empty and closed, rent recovered");
            closed = true;
            break;
        };
        // A market holding fewer than two free blocks is topped up by the
        // collector before compaction, so one run may grow it by two blocks.
        assert!(
            account.data.len() <= previous_len + 2 * MARKET_BLOCK_SIZE,
            "defrag grew the market from {previous_len} to {}",
            account.data.len()
        );
        if account.data.len() == previous_len && run > 0 {
            break;
        }
        previous_len = account.data.len();
    }
    if closed {
        return Ok(());
    }

    // Converged: two spare blocks, excess swept, every order and every funded
    // seat preserved under the same owner with the same balances.
    let account = market_account(&f, &market_key).await.unwrap();
    let after: MarketValue = get_dynamic_value_or(account.data.as_slice())?;
    assert_eq!(after.free_blocks_short_of_n(2), Some(0), "{market_pk}");
    assert_eq!(
        account.lamports,
        Rent::default().minimum_balance(account.data.len()),
        "market excess was not swept on {market_pk}"
    );
    assert_eq!(book(&after), book_before, "orders changed on {market_pk}");
    let seats_after = seats(&after);
    for (trader, balances) in &seats_before {
        let has_orders = book_before.iter().any(|(_, _, _, owner)| owner == trader);
        if *balances != (0, 0) || has_orders {
            assert_eq!(
                seats_after.get(trader),
                Some(balances),
                "seat {trader} lost state on {market_pk}"
            );
        }
    }
    println!(
        "    compacted {} -> {} bytes, {} orders and {} seats preserved",
        market_bytes.len(),
        account.data.len(),
        book_before.len(),
        seats_after.len()
    );

    // The fee leg: a fresh trader claims a seat on the compacted market,
    // deposits quote, and a batch with one reverse order pays exactly the
    // flat fee to the market. Only classic quote vaults keep the token
    // account synthesis simple.
    if quote_program != spl_token::id() {
        println!("    token-2022 quote vault, skipping fee leg");
        return Ok(());
    }
    let trader = f.payer_keypair().insecure_clone();
    send_tx_with_retry(
        Rc::clone(&f.context),
        &[claim_seat_instruction(&market_key, &trader.pubkey())],
        Some(&trader.pubkey()),
        &[&trader],
    )
    .await?;
    // Spare blocks ahead of time so the batch below cannot trigger an
    // expansion transfer and the fee is the only lamport move to the market.
    let mut expand: Instruction = expand_market_instruction(&market_key, &trader.pubkey());
    expand.data.extend_from_slice(&10u32.to_le_bytes());
    send_tx_with_retry(
        Rc::clone(&f.context),
        &[expand],
        Some(&trader.pubkey()),
        &[&trader],
    )
    .await?;

    let trader_quote: Pubkey = Pubkey::new_unique();
    let mut token_account = Account::new(
        u32::MAX as u64,
        spl_token::state::Account::LEN,
        &spl_token::id(),
    );
    spl_token::state::Account {
        mint: quote_mint,
        owner: trader.pubkey(),
        amount: 1_000_000,
        state: spl_token::state::AccountState::Initialized,
        ..spl_token::state::Account::default()
    }
    .pack_into_slice(&mut token_account.data);
    f.context
        .borrow_mut()
        .set_account(&trader_quote, &AccountSharedData::from(token_account));
    send_tx_with_retry(
        Rc::clone(&f.context),
        &[deposit_instruction(
            &market_key,
            &trader.pubkey(),
            &quote_mint,
            1_000,
            &trader_quote,
            spl_token::id(),
            None,
        )],
        Some(&trader.pubkey()),
        &[&trader],
    )
    .await?;

    let before_fee = market_account(&f, &market_key).await.unwrap().lamports;
    // A bid priced at 1e-10 rests under any live book instead of crossing it.
    send_tx_with_retry(
        Rc::clone(&f.context),
        &[batch_update_instruction(
            &market_key,
            &trader.pubkey(),
            None,
            vec![],
            vec![PlaceOrderParams::new(
                100,
                1,
                -10,
                true,
                OrderType::Reverse,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            None,
            None,
            None,
            None,
        )],
        Some(&trader.pubkey()),
        &[&trader],
    )
    .await?;
    assert_eq!(
        market_account(&f, &market_key).await.unwrap().lamports,
        before_fee + ADVANCED_ORDER_FEE_LAMPORTS,
        "advanced order fee not collected on {market_pk}"
    );
    println!("    reverse order batch paid the {ADVANCED_ORDER_FEE_LAMPORTS} lamport fee");

    // The next defrag sweeps that fee to the collector.
    let collector_before = f.try_load(&collector.pubkey()).await?.unwrap().lamports;
    send_tx_with_retry(
        Rc::clone(&f.context),
        &[
            ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
            defrag.clone(),
        ],
        Some(&f.payer()),
        &[&f.payer_keypair(), &collector],
    )
    .await?;
    let account = market_account(&f, &market_key).await.unwrap();
    assert_eq!(
        account.lamports,
        Rent::default().minimum_balance(account.data.len())
    );
    let collected = f.try_load(&collector.pubkey()).await?.unwrap().lamports - collector_before;
    assert!(
        collected >= ADVANCED_ORDER_FEE_LAMPORTS,
        "defrag collected {collected}, expected at least the fee"
    );
    println!("    defrag swept {collected} lamports to the collector");
    Ok(())
}
