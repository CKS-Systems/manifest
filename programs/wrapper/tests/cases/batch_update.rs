use std::{cell::RefMut, mem::size_of, rc::Rc};

use manifest::state::{constants::NO_EXPIRATION_LAST_VALID_SLOT, OrderType};
use hypertree::{get_helper, DataIndex, RBNode, TreeReadOperations, NIL};
use solana_program_test::{tokio, ProgramTestContext};
use solana_sdk::{
    account::Account, instruction::Instruction, pubkey::Pubkey, signature::Keypair, signer::Signer,
    transaction::Transaction,
};
use wrapper::{
    instruction_builders::{batch_update_instruction, create_wrapper_instructions},
    market_info::MarketInfo,
    processors::{
        batch_upate::{WrapperCancelOrderParams, WrapperPlaceOrderParams},
        shared::MarketInfosTree,
    },
    wrapper_state::ManifestWrapperStateFixed,
};

use crate::{send_tx_with_retry, TestFixture, Token, SOL_UNIT_SIZE, USDC_UNIT_SIZE};

#[tokio::test]
async fn wrapper_batch_update_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, SOL_UNIT_SIZE).await?;

    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let mut program_test_context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    // There is no order 0 for the cancel to get, but it will fail silently and continue on.
    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![WrapperCancelOrderParams::new(0)],
        false,
        vec![WrapperPlaceOrderParams::new(
            0,
            1 * SOL_UNIT_SIZE,
            1,
            0,
            false,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            0,
        )],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&payer),
            &[&payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    // Cancel and place, so we have enough funds for the second one.
    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![WrapperCancelOrderParams::new(0)],
        false,
        vec![WrapperPlaceOrderParams::new(
            0,
            1 * SOL_UNIT_SIZE,
            1,
            0,
            false,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            0,
        )],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&payer),
            &[&payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    Ok(())
}

#[tokio::test]
async fn wrapper_batch_update_reuse_client_order_id_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, 10 * SOL_UNIT_SIZE).await?;

    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let mut program_test_context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    // All the orders have the same client order id.
    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![],
        false,
        vec![
            WrapperPlaceOrderParams::new(
                0,
                1 * SOL_UNIT_SIZE,
                1,
                0,
                false,
                NO_EXPIRATION_LAST_VALID_SLOT,
                OrderType::Limit,
                0,
            ),
            WrapperPlaceOrderParams::new(
                0,
                1 * SOL_UNIT_SIZE,
                1,
                0,
                false,
                NO_EXPIRATION_LAST_VALID_SLOT,
                OrderType::Limit,
                0,
            ),
            WrapperPlaceOrderParams::new(
                0,
                1 * SOL_UNIT_SIZE,
                1,
                0,
                false,
                NO_EXPIRATION_LAST_VALID_SLOT,
                OrderType::Limit,
                0,
            ),
            WrapperPlaceOrderParams::new(
                0,
                1 * SOL_UNIT_SIZE,
                1,
                0,
                false,
                NO_EXPIRATION_LAST_VALID_SLOT,
                OrderType::Limit,
                0,
            ),
            WrapperPlaceOrderParams::new(
                0,
                1 * SOL_UNIT_SIZE,
                1,
                0,
                false,
                NO_EXPIRATION_LAST_VALID_SLOT,
                OrderType::Limit,
                0,
            ),
        ],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&payer),
            &[&payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    // Cancel order 0 which is all of them
    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![WrapperCancelOrderParams::new(0)],
        false,
        vec![],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&payer),
            &[&payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    // Assert that there are no more orders on the book.
    let mut wrapper_account: Account = program_test_context
        .banks_client
        .get_account(test_fixture.wrapper.key)
        .await
        .expect("Fetch wrapper")
        .expect("Wrapper is not none");
    let (fixed_data, wrapper_dynamic_data) =
        wrapper_account.data[..].split_at_mut(size_of::<ManifestWrapperStateFixed>());

    let wrapper_fixed: &ManifestWrapperStateFixed = get_helper(fixed_data, 0);
    let market_infos_tree: MarketInfosTree = MarketInfosTree::new(
        wrapper_dynamic_data,
        wrapper_fixed.market_infos_root_index,
        NIL,
    );

    let market_info_index: DataIndex =
        market_infos_tree.lookup_index(&MarketInfo::new_empty(test_fixture.market.key, NIL));
    let market_info: &MarketInfo =
        get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index).get_value();
    let orders_root_index: DataIndex = market_info.orders_root_index;
    assert_eq!(
        orders_root_index, NIL,
        "Deleted all orders since they all had same client order id"
    );

    Ok(())
}

#[tokio::test]
async fn sync_remove_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, 10 * SOL_UNIT_SIZE).await?;

    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let second_payer: Pubkey = test_fixture.second_keypair.pubkey();
    let second_payer_keypair: Keypair = test_fixture.second_keypair.insecure_clone();
    let second_wrapper_keypair: Keypair = Keypair::new();

    let create_wrapper_ixs: Vec<Instruction> = create_wrapper_instructions(
        &second_payer,
        &second_payer,
        &second_wrapper_keypair.pubkey(),
    )
    .unwrap();

    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &create_wrapper_ixs[..],
        Some(&second_payer),
        &[&second_payer_keypair, &second_wrapper_keypair],
    )
    .await;

    test_fixture
        .claim_seat_for_keypair_with_wrapper(
            &test_fixture.second_keypair.insecure_clone(),
            &second_wrapper_keypair.pubkey(),
        )
        .await?;
    test_fixture
        .deposit_for_keypair_with_wrapper(
            Token::USDC,
            1_000 * USDC_UNIT_SIZE,
            &test_fixture.second_keypair.insecure_clone(),
            &second_wrapper_keypair.pubkey(),
        )
        .await?;

    let mut program_test_context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![],
        false,
        vec![WrapperPlaceOrderParams::new(
            0,
            1 * SOL_UNIT_SIZE,
            1,
            0,
            false,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            0,
        )],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&payer),
            &[&payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &second_payer,
        &second_wrapper_keypair.pubkey(),
        vec![],
        false,
        vec![WrapperPlaceOrderParams::new(
            0,
            1 * SOL_UNIT_SIZE,
            1,
            0,
            true,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            0,
        )],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&second_payer),
            &[&second_payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![],
        false,
        vec![],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&payer),
            &[&payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    // Assert that there are no more orders on the book.
    let mut wrapper_account: Account = program_test_context
        .banks_client
        .get_account(test_fixture.wrapper.key)
        .await
        .expect("Fetch wrapper")
        .expect("Wrapper is not none");
    let (fixed_data, wrapper_dynamic_data) =
        wrapper_account.data[..].split_at_mut(size_of::<ManifestWrapperStateFixed>());

    let wrapper_fixed: &ManifestWrapperStateFixed = get_helper(fixed_data, 0);
    let market_infos_tree: MarketInfosTree = MarketInfosTree::new(
        wrapper_dynamic_data,
        wrapper_fixed.market_infos_root_index,
        NIL,
    );

    // Just need to lookup by market key so the rest doesnt matter.
    let market_info_index: DataIndex =
        market_infos_tree.lookup_index(&MarketInfo::new_empty(test_fixture.market.key, NIL));

    let market_info: &MarketInfo =
        get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index).get_value();
    let orders_root_index: DataIndex = market_info.orders_root_index;
    assert_eq!(orders_root_index, NIL, "Order matched");

    Ok(())
}

#[tokio::test]
async fn wrapper_batch_update_cancel_all_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, SOL_UNIT_SIZE).await?;

    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let mut program_test_context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![],
        false,
        vec![WrapperPlaceOrderParams::new(
            0,
            1 * SOL_UNIT_SIZE,
            1,
            0,
            false,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            0,
        )],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&payer),
            &[&payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![],
        true,
        vec![],
        None,
    );
    let batch_update_tx: Transaction = {
        Transaction::new_signed_with_payer(
            &[batch_update_ix],
            Some(&payer),
            &[&payer_keypair],
            program_test_context.get_new_latest_blockhash().await?,
        )
    };

    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    // Assert that there are no more orders on the book.
    let mut wrapper_account: Account = program_test_context
        .banks_client
        .get_account(test_fixture.wrapper.key)
        .await
        .expect("Fetch wrapper")
        .expect("Wrapper is not none");
    let (fixed_data, wrapper_dynamic_data) =
        wrapper_account.data[..].split_at_mut(size_of::<ManifestWrapperStateFixed>());

    let wrapper_fixed: &ManifestWrapperStateFixed = get_helper(fixed_data, 0);
    let market_infos_tree: MarketInfosTree = MarketInfosTree::new(
        wrapper_dynamic_data,
        wrapper_fixed.market_infos_root_index,
        NIL,
    );

    let market_info_index: DataIndex =
        market_infos_tree.lookup_index(&MarketInfo::new_empty(test_fixture.market.key, NIL));

    let market_info: &MarketInfo =
        get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index).get_value();
    let orders_root_index: DataIndex = market_info.orders_root_index;
    assert_eq!(orders_root_index, NIL, "Deleted all orders in cancel all");

    Ok(())
}

#[tokio::test]
async fn wrapper_batch_update_trader_index_hint_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, SOL_UNIT_SIZE).await?;

    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let mut program_test_context: RefMut<ProgramTestContext> = test_fixture.context.borrow_mut();

    let batch_update_ix: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        vec![WrapperCancelOrderParams::new(0)],
        false,
        vec![WrapperPlaceOrderParams::new(
            0,
            1 * SOL_UNIT_SIZE,
            1,
            0,
            false,
            NO_EXPIRATION_LAST_VALID_SLOT,
            OrderType::Limit,
            0,
        )],
        Some(0),
    );
    let batch_update_tx: Transaction = Transaction::new_signed_with_payer(
        &[batch_update_ix],
        Some(&payer),
        &[&payer_keypair],
        program_test_context.get_new_latest_blockhash().await?,
    );
    program_test_context
        .banks_client
        .process_transaction(batch_update_tx)
        .await?;

    Ok(())
}
