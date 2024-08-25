use std::cell::RefMut;

use hypertree::DataIndex;
use manifest::{
    program::{batch_update::CancelOrderParams, batch_update_instruction},
    state::{OrderType, BLOCK_SIZE},
};
use solana_program_test::{tokio, ProgramTestContext};
use solana_sdk::{
    instruction::Instruction, signature::Keypair, signer::Signer, transaction::Transaction,
};

use crate::{Side, TestFixture, Token, SOL_UNIT_SIZE, USDC_UNIT_SIZE};

#[tokio::test]
async fn cancel_order_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, SOL_UNIT_SIZE).await?;

    test_fixture
        .place_order(Side::Ask, 1, 1.0, u32::MAX, OrderType::Limit)
        .await?;

    // First order always has order sequence number of zero.
    test_fixture.cancel_order(0).await?;

    Ok(())
}

#[tokio::test]
async fn cancel_order_bid_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::USDC, USDC_UNIT_SIZE).await?;

    test_fixture
        .place_order(Side::Bid, 1, 1.0, u32::MAX, OrderType::Limit)
        .await?;

    // First order always has order sequence number of zero.
    test_fixture.cancel_order(0).await?;

    Ok(())
}

#[tokio::test]
async fn cancel_order_fail_other_trader_order_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    // Should succeed. It was funded with infinite lamports.
    let second_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    test_fixture.claim_seat_for_keypair(&second_keypair).await?;
    test_fixture
        .deposit_for_keypair(Token::SOL, 2 * SOL_UNIT_SIZE, &second_keypair)
        .await?;
    test_fixture
        .place_order_for_keypair(
            Side::Ask,
            1,
            1.0,
            u32::MAX,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    assert!(test_fixture.cancel_order(0).await.is_err());

    assert!(test_fixture
        .batch_update_for_keypair(
            None,
            vec![CancelOrderParams::new_with_hint(
                0,
                Some((BLOCK_SIZE * 2) as DataIndex)
            )],
            vec![],
            &test_fixture.payer_keypair()
        )
        .await
        .is_err());

    Ok(())
}

#[tokio::test]
async fn cancel_order_sequence_number_not_exist_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    test_fixture.deposit(Token::SOL, SOL_UNIT_SIZE).await?;
    test_fixture
        .place_order(Side::Ask, 1, 1.0, u32::MAX, OrderType::Limit)
        .await?;

    // Sequence number does not exist, but it fails open.
    test_fixture.cancel_order(1234).await?;

    Ok(())
}

#[tokio::test]
async fn cancel_order_multiple_bid_on_orderbook_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture
        .deposit(Token::USDC, 10 * USDC_UNIT_SIZE)
        .await?;

    test_fixture
        .place_order(Side::Bid, 1, 1.0, u32::MAX, OrderType::Limit)
        .await?;
    test_fixture
        .place_order(Side::Bid, 2, 2.0, u32::MAX, OrderType::Limit)
        .await?;

    // First order always has order sequence number of zero.
    test_fixture.cancel_order(0).await?;

    Ok(())
}

#[tokio::test]
async fn cancel_order_with_hint_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, SOL_UNIT_SIZE).await?;

    test_fixture
        .place_order(Side::Ask, 1, 1.0, u32::MAX, OrderType::Limit)
        .await?;

    // First order always has order sequence number of zero.
    test_fixture.cancel_order(0).await?;

    let mut context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();
    let cancel_order_ix: Instruction = batch_update_instruction(
        &test_fixture.market_fixture.key,
        &context.payer.pubkey(),
        None,
        vec![
            // 0 is ClaimedSeat, next is the order
            CancelOrderParams::new_with_hint(0, Some((1 * BLOCK_SIZE).try_into().unwrap())),
        ],
        vec![],
        None,
        None,
        None,
        None,
    );
    let hash: solana_sdk::hash::Hash = context.get_new_latest_blockhash().await?;

    let cancel_order_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[cancel_order_ix],
            Some(&context.payer.pubkey()),
            &[&context.payer],
            hash,
        )
    };

    context
        .banks_client
        .process_transaction(cancel_order_tx)
        .await?;

    Ok(())
}
