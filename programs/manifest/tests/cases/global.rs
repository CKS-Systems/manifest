use std::rc::Rc;

use manifest::{
    program::{
        batch_update::{CancelOrderParams, PlaceOrderParams},
        batch_update_instruction, global_add_trader_instruction, global_deposit_instruction,
        swap_instruction,
    },
    quantities::{GlobalAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{DynamicAccount, GlobalFixed, OrderType, RestingOrder, NO_EXPIRATION_LAST_VALID_SLOT},
};
use solana_program_test::tokio;
use solana_sdk::{instruction::Instruction, pubkey::Pubkey, signature::Keypair};

use crate::{
    send_tx_with_retry, GlobalFixture, MarketFixture, MintFixture, TestFixture, Token,
    TokenAccountFixture,
};

#[tokio::test]
async fn create_global() -> anyhow::Result<()> {
    let _test_fixture: TestFixture = TestFixture::new().await;

    Ok(())
}

#[tokio::test]
async fn global_add_trader() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer: Pubkey = test_fixture.payer();
    test_fixture.global_add_trader().await?;

    test_fixture.global_fixture.reload().await;
    let global_dynamic_account: DynamicAccount<GlobalFixed, Vec<u8>> =
        test_fixture.global_fixture.global;

    // Verifying that the account exists and that there are zero there.
    let balance_atoms: GlobalAtoms = global_dynamic_account.get_balance_atoms(&payer);
    assert_eq!(balance_atoms, GlobalAtoms::ZERO);
    Ok(())
}

#[tokio::test]
async fn global_add_trader_repeat_fail() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.global_add_trader().await?;

    assert!(test_fixture.global_add_trader().await.is_err());
    Ok(())
}

#[tokio::test]
async fn global_deposit() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer: Pubkey = test_fixture.payer();
    test_fixture.global_add_trader().await?;
    test_fixture.global_deposit(1_000_000).await?;

    test_fixture.global_fixture.reload().await;
    let global_dynamic_account: DynamicAccount<GlobalFixed, Vec<u8>> =
        test_fixture.global_fixture.global;

    // Verifying that the account exists and that there are tokens there.
    let balance_atoms: GlobalAtoms = global_dynamic_account.get_balance_atoms(&payer);
    assert_eq!(balance_atoms, GlobalAtoms::new(1_000_000));
    Ok(())
}

#[tokio::test]
async fn global_withdraw() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer: Pubkey = test_fixture.payer();
    test_fixture.global_add_trader().await?;
    test_fixture.global_deposit(1_000_000).await?;
    test_fixture.global_withdraw(1_000_000).await?;

    test_fixture.global_fixture.reload().await;
    let global_dynamic_account: DynamicAccount<GlobalFixed, Vec<u8>> =
        test_fixture.global_fixture.global;

    // Verifying that the account exists and that there are tokens there.
    let balance_atoms: GlobalAtoms = global_dynamic_account.get_balance_atoms(&payer);
    assert_eq!(balance_atoms, GlobalAtoms::new(0));
    Ok(())
}

#[tokio::test]
async fn global_place_order() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    test_fixture.global_add_trader().await?;
    test_fixture.global_deposit(1_000_000).await?;

    test_fixture
        .batch_update_with_global_for_keypair(
            None,
            vec![],
            vec![PlaceOrderParams::new(
                10,
                1,
                0,
                true,
                OrderType::Global,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair().insecure_clone(),
        )
        .await?;

    test_fixture.market_fixture.reload().await;
    let orders: Vec<RestingOrder> = test_fixture.market_fixture.get_resting_orders().await;
    assert_eq!(orders.len(), 1, "Could not find resting order");

    Ok(())
}

#[tokio::test]
async fn global_place_order_only_global_quote() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    test_fixture.global_add_trader().await?;
    test_fixture.global_deposit(1_000_000).await?;

    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market_fixture.key,
        &test_fixture.payer(),
        None,
        vec![],
        vec![PlaceOrderParams::new(
            10,
            1,
            0,
            true,
            OrderType::Global,
            NO_EXPIRATION_LAST_VALID_SLOT,
        )],
        None,
        None,
        Some(*test_fixture.market_fixture.market.get_quote_mint()),
        None,
    );

    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[batch_update_ix],
        Some(&test_fixture.payer()),
        &[&test_fixture.payer_keypair().insecure_clone()],
    )
    .await?;

    test_fixture.market_fixture.reload().await;
    let orders: Vec<RestingOrder> = test_fixture.market_fixture.get_resting_orders().await;
    assert_eq!(orders.len(), 1, "Could not find resting order");
    assert_eq!(
        orders.get(0).unwrap().get_num_base_atoms(),
        10,
        "Order size was wrong"
    );
    assert_eq!(
        orders.get(0).unwrap().get_price(),
        QuoteAtomsPerBaseAtom::try_from(1.0).unwrap(),
        "Order price was wrong"
    );
    assert_eq!(
        orders.get(0).unwrap().get_order_type(),
        OrderType::Global,
        "Order type was wrong"
    );

    Ok(())
}

#[tokio::test]
async fn global_cancel_order() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    test_fixture.global_add_trader().await?;
    test_fixture.global_deposit(1_000_000).await?;

    test_fixture
        .batch_update_with_global_for_keypair(
            None,
            vec![],
            vec![PlaceOrderParams::new(
                10,
                1,
                0,
                true,
                OrderType::Global,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair().insecure_clone(),
        )
        .await?;

    test_fixture
        .batch_update_with_global_for_keypair(
            None,
            vec![CancelOrderParams::new(0)],
            vec![],
            &test_fixture.payer_keypair().insecure_clone(),
        )
        .await?;

    test_fixture.market_fixture.reload().await;
    let orders: Vec<RestingOrder> = test_fixture.market_fixture.get_resting_orders().await;
    assert_eq!(orders.len(), 0, "Did not cancel");
    test_fixture.global_fixture.reload().await;

    Ok(())
}

#[tokio::test]
async fn global_match_order() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    test_fixture.global_add_trader().await?;
    test_fixture.global_deposit(1_000_000).await?;

    test_fixture
        .batch_update_with_global_for_keypair(
            None,
            vec![],
            vec![PlaceOrderParams::new(
                100,
                1,
                0,
                true,
                OrderType::Global,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair().insecure_clone(),
        )
        .await?;

    test_fixture.deposit(Token::SOL, 1_000_000).await?;

    test_fixture
        .batch_update_with_global_for_keypair(
            None,
            vec![],
            vec![PlaceOrderParams::new(
                100,
                9,
                -1,
                false,
                OrderType::Limit,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair().insecure_clone(),
        )
        .await?;

    test_fixture.market_fixture.reload().await;
    let orders: Vec<RestingOrder> = test_fixture.market_fixture.get_resting_orders().await;
    assert_eq!(orders.len(), 0, "Order still on orderbook");

    assert_eq!(
        test_fixture
            .market_fixture
            .get_base_balance_atoms(&test_fixture.payer())
            .await,
        1_000_000
    );
    assert_eq!(
        test_fixture
            .market_fixture
            .get_quote_balance_atoms(&test_fixture.payer())
            .await,
        100
    );
    test_fixture.global_fixture.reload().await;
    assert_eq!(
        test_fixture
            .global_fixture
            .global
            .get_balance_atoms(&test_fixture.payer()),
        999_900
    );

    Ok(())
}

#[tokio::test]
async fn global_deposit_22() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();

    let mut usdc_mint_fixture: MintFixture =
        MintFixture::new_with_version(Rc::clone(&test_fixture.context), Some(9), true).await;
    let mut global_fixture: GlobalFixture = GlobalFixture::new_with_token_program(
        Rc::clone(&test_fixture.context),
        &usdc_mint_fixture.key,
        &spl_token_2022::id(),
    )
    .await;

    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[global_add_trader_instruction(&global_fixture.key, &payer)],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    // Make a throw away token account
    let token_account_keypair: Keypair = Keypair::new();
    let token_account_fixture: TokenAccountFixture = TokenAccountFixture::new_with_keypair_2022(
        Rc::clone(&test_fixture.context),
        &global_fixture.mint_key,
        &payer,
        &token_account_keypair,
    )
    .await;
    usdc_mint_fixture
        .mint_to_2022(&token_account_fixture.key, 1_000_000)
        .await;
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[global_deposit_instruction(
            &global_fixture.mint_key,
            &payer,
            &token_account_fixture.key,
            &spl_token_2022::id(),
            1_000_000,
        )],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    global_fixture.reload().await;
    let global_dynamic_account: DynamicAccount<GlobalFixed, Vec<u8>> = global_fixture.global;

    // Verifying that the account exists and that there are tokens there.
    let balance_atoms: GlobalAtoms = global_dynamic_account.get_balance_atoms(&payer);
    assert_eq!(balance_atoms, GlobalAtoms::new(1_000_000));
    Ok(())
}

#[tokio::test]
async fn global_match_22() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();

    let mut usdc_mint_fixture: MintFixture =
        MintFixture::new_with_version(Rc::clone(&test_fixture.context), Some(9), true).await;
    let mut global_fixture: GlobalFixture = GlobalFixture::new_with_token_program(
        Rc::clone(&test_fixture.context),
        &usdc_mint_fixture.key,
        &spl_token_2022::id(),
    )
    .await;

    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[global_add_trader_instruction(&global_fixture.key, &payer)],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    // Make a throw away token account
    let token_account_keypair: Keypair = Keypair::new();
    let token_account_fixture: TokenAccountFixture = TokenAccountFixture::new_with_keypair_2022(
        Rc::clone(&test_fixture.context),
        &global_fixture.mint_key,
        &payer,
        &token_account_keypair,
    )
    .await;
    usdc_mint_fixture
        .mint_to_2022(&token_account_fixture.key, 1_000_000)
        .await;

    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[global_deposit_instruction(
            &global_fixture.mint_key,
            &payer,
            &token_account_fixture.key,
            &spl_token_2022::id(),
            1_000_000,
        )],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    let mut market_fixture: MarketFixture = MarketFixture::new(
        Rc::clone(&test_fixture.context),
        &test_fixture.sol_mint_fixture.key,
        &usdc_mint_fixture.key,
    )
    .await;
    market_fixture.reload().await;

    let claim_seat_ix: Instruction =
        manifest::program::claim_seat_instruction(&market_fixture.key, &payer);
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[claim_seat_ix],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    let batch_update_ix: Instruction = batch_update_instruction(
        &market_fixture.key,
        &payer,
        None,
        vec![],
        vec![PlaceOrderParams::new(
            1_000_000,
            1,
            0,
            true,
            OrderType::Global,
            NO_EXPIRATION_LAST_VALID_SLOT,
        )],
        Some(*market_fixture.market.get_base_mint()),
        Some(spl_token::id()),
        Some(*market_fixture.market.get_quote_mint()),
        Some(spl_token_2022::id()),
    );

    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[batch_update_ix],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    // Setup the second keypair to take.
    test_fixture
        .sol_mint_fixture
        .mint_to(&test_fixture.payer_sol_fixture.key, 1_000_000)
        .await;

    let swap_ix: Instruction = swap_instruction(
        &market_fixture.key,
        &payer,
        &test_fixture.sol_mint_fixture.key,
        &usdc_mint_fixture.key,
        &test_fixture.payer_sol_fixture.key,
        &token_account_fixture.key,
        1_000,
        0,
        true,
        true,
        spl_token::id(),
        spl_token_2022::id(),
        true,
    );

    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[swap_ix],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    global_fixture.reload().await;
    let global_dynamic_account: DynamicAccount<GlobalFixed, Vec<u8>> = global_fixture.global;

    // Verify that the global account traded all of its tokens.
    let balance_atoms: GlobalAtoms = global_dynamic_account.get_balance_atoms(&payer);
    assert_eq!(balance_atoms, GlobalAtoms::new(999_000));
    market_fixture.reload().await;
    // Zero because swaps reset the amounts, even if it is a self trade.
    assert_eq!(market_fixture.get_base_balance_atoms(&payer).await, 0);
    assert_eq!(market_fixture.get_quote_balance_atoms(&payer).await, 0);
    Ok(())
}

#[tokio::test]
async fn global_insufficient() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    test_fixture.global_add_trader().await?;
    test_fixture.global_deposit(1_000_000).await?;

    test_fixture
        .batch_update_with_global_for_keypair(
            None,
            vec![],
            vec![PlaceOrderParams::new(
                100,
                1,
                0,
                true,
                OrderType::Global,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair().insecure_clone(),
        )
        .await?;
    test_fixture.global_withdraw(1_000_000).await?;

    test_fixture.deposit(Token::SOL, 1_000_000).await?;

    test_fixture
        .batch_update_with_global_for_keypair(
            None,
            vec![],
            vec![PlaceOrderParams::new(
                100,
                9,
                -1,
                false,
                OrderType::ImmediateOrCancel,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair().insecure_clone(),
        )
        .await?;

    test_fixture.market_fixture.reload().await;
    let orders: Vec<RestingOrder> = test_fixture.market_fixture.get_resting_orders().await;
    // Remove unbacked global order.
    assert_eq!(orders.len(), 0, "Order still on orderbook");

    // No trade happened.
    assert_eq!(
        test_fixture
            .market_fixture
            .get_base_balance_atoms(&test_fixture.payer())
            .await,
        1_000_000
    );
    assert_eq!(
        test_fixture
            .market_fixture
            .get_quote_balance_atoms(&test_fixture.payer())
            .await,
        0
    );
    test_fixture.global_fixture.reload().await;
    assert_eq!(
        test_fixture
            .global_fixture
            .global
            .get_balance_atoms(&test_fixture.payer()),
        0
    );

    Ok(())
}

#[tokio::test]
async fn global_get_balance_not_in_global() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer: Pubkey = test_fixture.payer();

    test_fixture.global_fixture.reload().await;
    let global_dynamic_account: DynamicAccount<GlobalFixed, Vec<u8>> =
        test_fixture.global_fixture.global;

    let balance_atoms: GlobalAtoms = global_dynamic_account.get_balance_atoms(&payer);
    assert_eq!(balance_atoms, GlobalAtoms::ZERO);
    Ok(())
}
