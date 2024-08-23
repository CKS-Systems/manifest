use std::{cell::RefMut, rc::Rc};

use borsh::BorshSerialize;
use manifest::{
    program::{
        batch_update::PlaceOrderParams, batch_update_instruction, global_add_trader_instruction,
        global_claim_seat_instruction, global_deposit_instruction, swap_instruction,
        ManifestInstruction, SwapParams,
    },
    state::{constants::NO_EXPIRATION_LAST_VALID_SLOT, OrderType},
    validation::get_vault_address,
};
use solana_program_test::{tokio, ProgramTestContext};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    signature::{Keypair, Signer},
    transaction::Transaction,
};

use crate::{
    send_tx_with_retry, Side, TestFixture, Token, TokenAccountFixture, SOL_UNIT_SIZE,
    USDC_UNIT_SIZE,
};

#[tokio::test]
async fn swap_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;

    // No deposits or seat claims needed
    test_fixture.swap(SOL_UNIT_SIZE, 0, true, true).await?;

    Ok(())
}

#[tokio::test]
async fn swap_full_match_test_sell_exact_in() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;

    let second_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    test_fixture.claim_seat_for_keypair(&second_keypair).await?;
    test_fixture
        .deposit_for_keypair(Token::USDC, 3_000 * USDC_UNIT_SIZE, &second_keypair)
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Bid,
            1 * SOL_UNIT_SIZE,
            1.0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Bid,
            1 * SOL_UNIT_SIZE,
            1.0,
            10,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Bid,
            2 * SOL_UNIT_SIZE,
            0.5,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .sol_mint_fixture
        .mint_to(&test_fixture.payer_sol_fixture.key, 3 * SOL_UNIT_SIZE)
        .await;

    test_fixture.advance_time_seconds(20).await;

    assert_eq!(
        test_fixture.payer_sol_fixture.balance_atoms().await,
        3 * SOL_UNIT_SIZE
    );
    assert_eq!(test_fixture.payer_usdc_fixture.balance_atoms().await, 0);
    test_fixture
        .swap(3 * SOL_UNIT_SIZE, 2_000 * USDC_UNIT_SIZE, true, true)
        .await?;

    assert_eq!(test_fixture.payer_sol_fixture.balance_atoms().await, 0);
    assert_eq!(
        test_fixture.payer_usdc_fixture.balance_atoms().await,
        2_000 * USDC_UNIT_SIZE
    );

    test_fixture
        .withdraw_for_keypair(Token::SOL, 3 * SOL_UNIT_SIZE, &second_keypair)
        .await?;
    test_fixture
        .withdraw_for_keypair(Token::USDC, 1_000 * USDC_UNIT_SIZE, &second_keypair)
        .await?;

    Ok(())
}

#[tokio::test]
async fn swap_full_match_test_sell_exact_out() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;

    let second_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    test_fixture.claim_seat_for_keypair(&second_keypair).await?;
    test_fixture
        .deposit_for_keypair(Token::USDC, 3_000 * USDC_UNIT_SIZE, &second_keypair)
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Bid,
            1 * SOL_UNIT_SIZE,
            1.0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Bid,
            1 * SOL_UNIT_SIZE,
            1.0,
            10,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Bid,
            2 * SOL_UNIT_SIZE,
            0.5,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .sol_mint_fixture
        .mint_to(&test_fixture.payer_sol_fixture.key, 3 * SOL_UNIT_SIZE)
        .await;

    test_fixture.advance_time_seconds(20).await;

    assert_eq!(
        test_fixture.payer_sol_fixture.balance_atoms().await,
        3 * SOL_UNIT_SIZE
    );
    assert_eq!(test_fixture.payer_usdc_fixture.balance_atoms().await, 0);
    test_fixture
        .swap(3 * SOL_UNIT_SIZE, 2_000 * USDC_UNIT_SIZE, true, false)
        .await?;

    assert_eq!(test_fixture.payer_sol_fixture.balance_atoms().await, 0);
    assert_eq!(
        test_fixture.payer_usdc_fixture.balance_atoms().await,
        2_000 * USDC_UNIT_SIZE
    );

    test_fixture
        .withdraw_for_keypair(Token::SOL, 3 * SOL_UNIT_SIZE, &second_keypair)
        .await?;
    test_fixture
        .withdraw_for_keypair(Token::USDC, 1_000 * USDC_UNIT_SIZE, &second_keypair)
        .await?;

    Ok(())
}

#[tokio::test]
async fn swap_full_match_test_buy_exact_in() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;

    let second_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    test_fixture.claim_seat_for_keypair(&second_keypair).await?;
    test_fixture
        .deposit_for_keypair(Token::SOL, 3 * SOL_UNIT_SIZE, &second_keypair)
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Ask,
            1 * SOL_UNIT_SIZE,
            1.0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Ask,
            1 * SOL_UNIT_SIZE,
            1.0,
            10,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .place_order_for_keypair(
            Side::Ask,
            1 * SOL_UNIT_SIZE,
            2.0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .usdc_mint_fixture
        .mint_to(&test_fixture.payer_usdc_fixture.key, 3_000 * USDC_UNIT_SIZE)
        .await;

    test_fixture.advance_time_seconds(20).await;

    assert_eq!(test_fixture.payer_sol_fixture.balance_atoms().await, 0);
    assert_eq!(
        test_fixture.payer_usdc_fixture.balance_atoms().await,
        3_000 * USDC_UNIT_SIZE
    );
    test_fixture
        .swap(3000 * USDC_UNIT_SIZE, 2 * SOL_UNIT_SIZE, false, true)
        .await?;

    assert_eq!(
        test_fixture.payer_sol_fixture.balance_atoms().await,
        2 * SOL_UNIT_SIZE
    );
    assert_eq!(test_fixture.payer_usdc_fixture.balance_atoms().await, 0);

    test_fixture
        .withdraw_for_keypair(Token::SOL, 1 * SOL_UNIT_SIZE, &second_keypair)
        .await?;
    test_fixture
        .withdraw_for_keypair(Token::USDC, 2_000 * USDC_UNIT_SIZE, &second_keypair)
        .await?;

    Ok(())
}

#[tokio::test]
async fn swap_already_has_deposits() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, 1 * SOL_UNIT_SIZE).await?;
    test_fixture
        .deposit(Token::USDC, 1_000 * USDC_UNIT_SIZE)
        .await?;

    let second_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    test_fixture.claim_seat_for_keypair(&second_keypair).await?;
    test_fixture
        .deposit_for_keypair(Token::SOL, 1 * SOL_UNIT_SIZE, &second_keypair)
        .await?;
    test_fixture
        .place_order_for_keypair(
            Side::Ask,
            1 * SOL_UNIT_SIZE,
            1.0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    test_fixture
        .usdc_mint_fixture
        .mint_to(&test_fixture.payer_usdc_fixture.key, 1_000 * USDC_UNIT_SIZE)
        .await;

    assert_eq!(test_fixture.payer_sol_fixture.balance_atoms().await, 0);
    assert_eq!(
        test_fixture.payer_usdc_fixture.balance_atoms().await,
        1_000 * USDC_UNIT_SIZE
    );
    test_fixture
        .swap(1000 * USDC_UNIT_SIZE, 1 * SOL_UNIT_SIZE, false, false)
        .await?;

    assert_eq!(
        test_fixture.payer_sol_fixture.balance_atoms().await,
        1 * SOL_UNIT_SIZE
    );
    assert_eq!(test_fixture.payer_usdc_fixture.balance_atoms().await, 0);

    Ok(())
}

#[tokio::test]
async fn swap_fail_limit_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer_keypair: Keypair = test_fixture.payer_keypair();
    test_fixture
        .usdc_mint_fixture
        .mint_to(
            &test_fixture.payer_usdc_fixture.key,
            10_000 * USDC_UNIT_SIZE,
        )
        .await;

    let mut context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let swap_ix: Instruction = swap_instruction(
        &test_fixture.market_fixture.key,
        &payer_keypair.pubkey(),
        &test_fixture.sol_mint_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
        &test_fixture.payer_sol_fixture.key,
        &test_fixture.payer_usdc_fixture.key,
        2_000 * USDC_UNIT_SIZE,
        2 * SOL_UNIT_SIZE,
        false,
        true,
        spl_token::id(),
        spl_token::id(),
        false,
    );

    let swap_tx: Transaction = Transaction::new_signed_with_payer(
        &[swap_ix],
        Some(&payer_keypair.pubkey()),
        &[&payer_keypair],
        context.get_new_latest_blockhash().await?,
    );

    assert!(context
        .banks_client
        .process_transaction(swap_tx)
        .await
        .is_err());

    Ok(())
}

#[tokio::test]
async fn swap_fail_wrong_user_base_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer_keypair: Keypair = test_fixture.payer_keypair();
    test_fixture
        .usdc_mint_fixture
        .mint_to(
            &test_fixture.payer_usdc_fixture.key,
            10_000 * USDC_UNIT_SIZE,
        )
        .await;

    let mut context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let (vault_base_account, _) = get_vault_address(
        &test_fixture.market_fixture.key,
        &test_fixture.sol_mint_fixture.key,
    );
    let (vault_quote_account, _) = get_vault_address(
        &test_fixture.market_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
    );

    let swap_ix: Instruction = Instruction {
        program_id: manifest::id(),
        accounts: vec![
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer_keypair.pubkey(), true),
            AccountMeta::new(test_fixture.market_fixture.key, false),
            AccountMeta::new(test_fixture.payer_usdc_fixture.key, false),
            AccountMeta::new(test_fixture.payer_usdc_fixture.key, false),
            AccountMeta::new(vault_base_account, false),
            AccountMeta::new(vault_quote_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: [
            ManifestInstruction::Swap.to_vec(),
            SwapParams::new(2_000 * USDC_UNIT_SIZE, 2 * SOL_UNIT_SIZE, false, true)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    };

    let swap_tx: Transaction = Transaction::new_signed_with_payer(
        &[swap_ix],
        Some(&payer_keypair.pubkey()),
        &[&payer_keypair],
        context.get_new_latest_blockhash().await?,
    );

    assert!(context
        .banks_client
        .process_transaction(swap_tx)
        .await
        .is_err());

    Ok(())
}

#[tokio::test]
async fn swap_fail_wrong_user_quote_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer_keypair: Keypair = test_fixture.payer_keypair();
    test_fixture
        .usdc_mint_fixture
        .mint_to(
            &test_fixture.payer_usdc_fixture.key,
            10_000 * USDC_UNIT_SIZE,
        )
        .await;

    let mut context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let (vault_base_account, _) = get_vault_address(
        &test_fixture.market_fixture.key,
        &test_fixture.sol_mint_fixture.key,
    );
    let (vault_quote_account, _) = get_vault_address(
        &test_fixture.market_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
    );

    let swap_ix: Instruction = Instruction {
        program_id: manifest::id(),
        accounts: vec![
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer_keypair.pubkey(), true),
            AccountMeta::new(test_fixture.market_fixture.key, false),
            AccountMeta::new(test_fixture.payer_sol_fixture.key, false),
            AccountMeta::new(test_fixture.payer_sol_fixture.key, false),
            AccountMeta::new(vault_base_account, false),
            AccountMeta::new(vault_quote_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: [
            ManifestInstruction::Swap.to_vec(),
            SwapParams::new(2_000 * USDC_UNIT_SIZE, 2 * SOL_UNIT_SIZE, false, true)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    };

    let swap_tx: Transaction = Transaction::new_signed_with_payer(
        &[swap_ix],
        Some(&payer_keypair.pubkey()),
        &[&payer_keypair],
        context.get_new_latest_blockhash().await?,
    );

    assert!(context
        .banks_client
        .process_transaction(swap_tx)
        .await
        .is_err());

    Ok(())
}

#[tokio::test]
async fn swap_fail_wrong_base_vault_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer_keypair: Keypair = test_fixture.payer_keypair();
    test_fixture
        .usdc_mint_fixture
        .mint_to(
            &test_fixture.payer_usdc_fixture.key,
            10_000 * USDC_UNIT_SIZE,
        )
        .await;

    let mut context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let (vault_quote_account, _) = get_vault_address(
        &test_fixture.market_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
    );

    let place_order_ix: Instruction = Instruction {
        program_id: manifest::id(),
        accounts: vec![
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer_keypair.pubkey(), true),
            AccountMeta::new(test_fixture.market_fixture.key, false),
            AccountMeta::new(test_fixture.payer_sol_fixture.key, false),
            AccountMeta::new(test_fixture.payer_usdc_fixture.key, false),
            AccountMeta::new(vault_quote_account, false),
            AccountMeta::new(vault_quote_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: [
            ManifestInstruction::Swap.to_vec(),
            SwapParams::new(2_000 * USDC_UNIT_SIZE, 2 * SOL_UNIT_SIZE, false, true)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    };

    let swap_ix: Transaction = Transaction::new_signed_with_payer(
        &[place_order_ix],
        Some(&payer_keypair.pubkey()),
        &[&payer_keypair],
        context.get_new_latest_blockhash().await?,
    );

    assert!(context
        .banks_client
        .process_transaction(swap_ix)
        .await
        .is_err());

    Ok(())
}

#[tokio::test]
async fn swap_fail_wrong_vault_quote_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let payer_keypair: Keypair = test_fixture.payer_keypair();
    test_fixture
        .usdc_mint_fixture
        .mint_to(
            &test_fixture.payer_usdc_fixture.key,
            10_000 * USDC_UNIT_SIZE,
        )
        .await;

    let mut context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let (vault_base_account, _) = get_vault_address(
        &test_fixture.market_fixture.key,
        &test_fixture.sol_mint_fixture.key,
    );

    let swap_ix: Instruction = Instruction {
        program_id: manifest::id(),
        accounts: vec![
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer_keypair.pubkey(), true),
            AccountMeta::new(test_fixture.market_fixture.key, false),
            AccountMeta::new(test_fixture.payer_sol_fixture.key, false),
            AccountMeta::new(test_fixture.payer_usdc_fixture.key, false),
            AccountMeta::new(vault_base_account, false),
            AccountMeta::new(vault_base_account, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: [
            ManifestInstruction::Swap.to_vec(),
            SwapParams::new(2_000 * USDC_UNIT_SIZE, 2 * SOL_UNIT_SIZE, false, true)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    };

    let swap_tx: Transaction = Transaction::new_signed_with_payer(
        &[swap_ix],
        Some(&payer_keypair.pubkey()),
        &[&payer_keypair],
        context.get_new_latest_blockhash().await?,
    );

    assert!(context
        .banks_client
        .process_transaction(swap_tx)
        .await
        .is_err());

    Ok(())
}

#[tokio::test]
async fn swap_fail_insufficient_funds_sell() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let second_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    test_fixture.claim_seat_for_keypair(&second_keypair).await?;
    test_fixture
        .deposit_for_keypair(Token::USDC, 2_000 * USDC_UNIT_SIZE, &second_keypair)
        .await?;
    test_fixture
        .place_order_for_keypair(
            Side::Bid,
            2 * SOL_UNIT_SIZE,
            1.0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    let payer_keypair: Keypair = test_fixture.payer_keypair();
    // Skip the deposit to the order from wallet.

    let mut context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let swap_ix: Instruction = swap_instruction(
        &test_fixture.market_fixture.key,
        &payer_keypair.pubkey(),
        &test_fixture.sol_mint_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
        &test_fixture.payer_sol_fixture.key,
        &test_fixture.payer_usdc_fixture.key,
        1 * SOL_UNIT_SIZE,
        1000 * USDC_UNIT_SIZE,
        true,
        true,
        spl_token::id(),
        spl_token::id(),
        false,
    );

    let swap_tx: Transaction = Transaction::new_signed_with_payer(
        &[swap_ix],
        Some(&payer_keypair.pubkey()),
        &[&payer_keypair],
        context.get_new_latest_blockhash().await?,
    );

    assert!(context
        .banks_client
        .process_transaction(swap_tx)
        .await
        .is_err());
    Ok(())
}

#[tokio::test]
async fn swap_fail_insufficient_funds_buy() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    let second_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    test_fixture.claim_seat_for_keypair(&second_keypair).await?;
    test_fixture
        .deposit_for_keypair(Token::SOL, 2 * SOL_UNIT_SIZE, &second_keypair)
        .await?;
    test_fixture
        .place_order_for_keypair(
            Side::Ask,
            2_000 * USDC_UNIT_SIZE,
            1.0,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            &second_keypair,
        )
        .await?;

    let payer_keypair: Keypair = test_fixture.payer_keypair();
    // Skip the deposit to the order from wallet.

    let mut context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let swap_ix: Instruction = swap_instruction(
        &test_fixture.market_fixture.key,
        &payer_keypair.pubkey(),
        &test_fixture.sol_mint_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
        &test_fixture.payer_sol_fixture.key,
        &test_fixture.payer_usdc_fixture.key,
        1000 * USDC_UNIT_SIZE,
        1 * SOL_UNIT_SIZE,
        false,
        true,
        spl_token::id(),
        spl_token::id(),
        false,
    );

    let swap_tx: Transaction = Transaction::new_signed_with_payer(
        &[swap_ix],
        Some(&payer_keypair.pubkey()),
        &[&payer_keypair],
        context.get_new_latest_blockhash().await?,
    );

    assert!(context
        .banks_client
        .process_transaction(swap_tx)
        .await
        .is_err());
    Ok(())
}

// Global is on the USDC, taker is sending in SOL.
#[tokio::test]
async fn swap_global() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;

    let second_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    test_fixture.claim_seat_for_keypair(&second_keypair).await?;

    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[global_add_trader_instruction(
            &test_fixture.global_fixture.key,
            &second_keypair.pubkey(),
        )],
        Some(&second_keypair.pubkey()),
        &[&second_keypair],
    )
    .await?;
    let global_claim_seat_ix: Instruction = global_claim_seat_instruction(
        &test_fixture.global_fixture.key,
        &second_keypair.pubkey(),
        &test_fixture.market_fixture.key,
    );
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[global_claim_seat_ix],
        Some(&second_keypair.pubkey()),
        &[&second_keypair],
    )
    .await?;

    // Make a throw away token account
    let token_account_keypair: Keypair = Keypair::new();
    let token_account_fixture: TokenAccountFixture = TokenAccountFixture::new_with_keypair(
        Rc::clone(&test_fixture.context),
        &test_fixture.global_fixture.mint_key,
        &second_keypair.pubkey(),
        &token_account_keypair,
    )
    .await;
    test_fixture
        .usdc_mint_fixture
        .mint_to(&token_account_fixture.key, 1 * SOL_UNIT_SIZE)
        .await;
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[global_deposit_instruction(
            &test_fixture.global_fixture.mint_key,
            &second_keypair.pubkey(),
            &token_account_fixture.key,
            &spl_token::id(),
            1 * SOL_UNIT_SIZE,
        )],
        Some(&second_keypair.pubkey()),
        &[&second_keypair],
    )
    .await?;

    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market_fixture.key,
        &second_keypair.pubkey(),
        None,
        vec![],
        vec![PlaceOrderParams::new(
            1 * SOL_UNIT_SIZE,
            1.0,
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
        Some(&second_keypair.pubkey()),
        &[&second_keypair],
    )
    .await?;

    test_fixture
        .sol_mint_fixture
        .mint_to(&test_fixture.payer_sol_fixture.key, 1 * SOL_UNIT_SIZE)
        .await;

    assert_eq!(
        test_fixture.payer_sol_fixture.balance_atoms().await,
        1 * SOL_UNIT_SIZE
    );
    assert_eq!(test_fixture.payer_usdc_fixture.balance_atoms().await, 0);
    test_fixture
        .swap_with_global(SOL_UNIT_SIZE, 1_000 * USDC_UNIT_SIZE, true, true)
        .await?;

    assert_eq!(test_fixture.payer_sol_fixture.balance_atoms().await, 0);
    assert_eq!(
        test_fixture.payer_usdc_fixture.balance_atoms().await,
        1_000 * USDC_UNIT_SIZE
    );

    Ok(())
}
