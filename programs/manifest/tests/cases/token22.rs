use std::{cell::RefCell, rc::Rc};

use manifest::{
    program::{
        batch_update::PlaceOrderParams, batch_update_instruction, claim_seat_instruction,
        create_market_instructions, deposit_instruction, swap_instruction, withdraw_instruction,
    },
    state::{OrderType, NO_EXPIRATION_LAST_VALID_SLOT},
};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    instruction::Instruction, program_pack::Pack, pubkey::Pubkey, rent::Rent, signature::Keypair,
    signer::Signer, system_instruction::create_account,
};

use crate::{send_tx_with_retry, MintFixture, RUST_LOG_DEFAULT};

#[tokio::test]
async fn token22_base() -> anyhow::Result<()> {
    // Create market with one token being 22
    // Deposit both sides, place order both sides, swap both ways, withdraw both sides

    let program_test: ProgramTest = ProgramTest::new(
        "manifest",
        manifest::ID,
        processor!(manifest::process_instruction),
    );

    solana_logger::setup_with_default(RUST_LOG_DEFAULT);

    let market_keypair: Keypair = Keypair::new();

    let context: Rc<RefCell<ProgramTestContext>> =
        Rc::new(RefCell::new(program_test.start_with_context().await));

    // Be careful. There are 2 payers. The one on the context that will shortly be created and this one. We dont just use the
    //let payer_keypair: Keypair = Keypair::new();
    //let payer: &Pubkey = &payer_keypair.pubkey();
    let payer_keypair: Keypair = context.borrow().payer.insecure_clone();
    let payer: &Pubkey = &payer_keypair.pubkey();

    // For this test, usdc is old token and spl is token22.
    let usdc_mint_f: MintFixture =
        MintFixture::new_with_version(Rc::clone(&context), Some(6), false).await;
    // Does not need to use extensions.
    let spl_mint_f: MintFixture =
        MintFixture::new_with_version(Rc::clone(&context), Some(9), true).await;
    let usdc_mint_key: Pubkey = usdc_mint_f.key;
    let spl_mint_key: Pubkey = spl_mint_f.key;

    // Create the market with SPL as base which is 2022, USDC as quote which is normal.
    let create_market_ixs: Vec<Instruction> = create_market_instructions(
        &market_keypair.pubkey(),
        &spl_mint_f.key,
        &usdc_mint_f.key,
        payer,
    )
    .unwrap();
    send_tx_with_retry(
        Rc::clone(&context),
        &create_market_ixs[..],
        Some(&payer),
        &[&payer_keypair.insecure_clone(), &market_keypair],
    )
    .await?;

    // Claim seats
    let claim_seat_ix: Instruction = claim_seat_instruction(&market_keypair.pubkey(), &payer);
    send_tx_with_retry(
        Rc::clone(&context),
        &[claim_seat_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Create depositor token accounts
    let usdc_token_account_keypair: Keypair = Keypair::new();
    let spl_token_account_keypair: Keypair = Keypair::new();
    let rent: Rent = context.borrow_mut().banks_client.get_rent().await.unwrap();
    let create_spl_token_account_ix: Instruction = create_account(
        payer,
        &spl_token_account_keypair.pubkey(),
        rent.minimum_balance(spl_token_2022::state::Account::LEN),
        spl_token_2022::state::Account::LEN as u64,
        &spl_token_2022::id(),
    );
    let init_spl_token_account_ix: Instruction = spl_token_2022::instruction::initialize_account(
        &spl_token_2022::id(),
        &spl_token_account_keypair.pubkey(),
        &spl_mint_key,
        payer,
    )
    .unwrap();
    let create_usdc_token_account_ix: Instruction = create_account(
        payer,
        &usdc_token_account_keypair.pubkey(),
        rent.minimum_balance(spl_token::state::Account::LEN),
        spl_token::state::Account::LEN as u64,
        &spl_token::id(),
    );
    let init_usdc_token_account_ix: Instruction = spl_token::instruction::initialize_account(
        &spl_token::id(),
        &usdc_token_account_keypair.pubkey(),
        &usdc_mint_key,
        payer,
    )
    .unwrap();
    send_tx_with_retry(
        Rc::clone(&context),
        &[
            create_spl_token_account_ix,
            init_spl_token_account_ix,
            create_usdc_token_account_ix,
            init_usdc_token_account_ix,
        ],
        Some(&payer),
        &[
            &payer_keypair.insecure_clone(),
            &spl_token_account_keypair.insecure_clone(),
            &usdc_token_account_keypair.insecure_clone(),
        ],
    )
    .await?;

    // Add funds to those token accounts.
    let spl_mint_to_instruction: Instruction = spl_token_2022::instruction::mint_to(
        &spl_token_2022::ID,
        &spl_mint_key,
        &spl_token_account_keypair.pubkey(),
        &payer,
        &[&payer],
        1_000_000_000_000_000,
    )
    .unwrap();
    let usdc_mint_to_instruction: Instruction = spl_token::instruction::mint_to(
        &spl_token::ID,
        &usdc_mint_key,
        &usdc_token_account_keypair.pubkey(),
        &payer,
        &[&payer],
        1_000_000_000_000_000,
    )
    .unwrap();
    send_tx_with_retry(
        Rc::clone(&context),
        &[spl_mint_to_instruction, usdc_mint_to_instruction],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Call deposit for each token account for a partial amount so we can swap later.
    let deposit_spl_ix: Instruction = deposit_instruction(
        &market_keypair.pubkey(),
        &payer,
        &spl_mint_key,
        1_000_000_000,
        &spl_token_account_keypair.pubkey(),
        spl_token_2022::id(),
        None,
    );
    let deposit_usdc_ix: Instruction = deposit_instruction(
        &market_keypair.pubkey(),
        &payer,
        &usdc_mint_key,
        1_000_000_000,
        &usdc_token_account_keypair.pubkey(),
        spl_token::id(),
        None,
    );
    send_tx_with_retry(
        Rc::clone(&context),
        &[deposit_spl_ix, deposit_usdc_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Call withdraw
    let withdraw_spl_ix: Instruction = withdraw_instruction(
        &market_keypair.pubkey(),
        &payer,
        &spl_mint_key,
        1_000,
        &spl_token_account_keypair.pubkey(),
        spl_token_2022::id(),
        None,
    );
    let withdraw_usdc_ix: Instruction = withdraw_instruction(
        &market_keypair.pubkey(),
        &payer,
        &usdc_mint_key,
        1_000,
        &usdc_token_account_keypair.pubkey(),
        spl_token::id(),
        None,
    );
    send_tx_with_retry(
        Rc::clone(&context),
        &[withdraw_spl_ix, withdraw_usdc_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Place orders on both sides to
    let place_order_ix: Instruction = batch_update_instruction(
        &market_keypair.pubkey(),
        &payer,
        None,
        vec![],
        vec![
            PlaceOrderParams::new(
                1_000,
                9,
                -1,
                true,
                OrderType::PostOnly,
                NO_EXPIRATION_LAST_VALID_SLOT,
            ),
            PlaceOrderParams::new(
                1_000,
                11,
                -1,
                false,
                OrderType::PostOnly,
                NO_EXPIRATION_LAST_VALID_SLOT,
            ),
        ],
        None,
        None,
        None,
        None,
    );
    send_tx_with_retry(
        Rc::clone(&context),
        &[place_order_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Swap using both directions
    let swap_base_in_ix: Instruction = swap_instruction(
        &market_keypair.pubkey(),
        &payer,
        &spl_mint_key,
        &usdc_mint_key,
        &spl_token_account_keypair.pubkey(),
        &usdc_token_account_keypair.pubkey(),
        100,
        10,
        true,
        true,
        spl_token_2022::id(),
        spl_token::id(),
        false,
    );
    let swap_base_out_ix: Instruction = swap_instruction(
        &market_keypair.pubkey(),
        &payer,
        &spl_mint_key,
        &usdc_mint_key,
        &spl_token_account_keypair.pubkey(),
        &usdc_token_account_keypair.pubkey(),
        100,
        10,
        false,
        true,
        spl_token_2022::id(),
        spl_token::id(),
        false,
    );
    send_tx_with_retry(
        Rc::clone(&context),
        &[swap_base_in_ix, swap_base_out_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    Ok(())
}

#[tokio::test]
async fn token22_quote() -> anyhow::Result<()> {
    // Create market with one token being 22
    // Deposit both sides, place order both sides, swap both ways, withdraw both sides

    let program_test: ProgramTest = ProgramTest::new(
        "manifest",
        manifest::ID,
        processor!(manifest::process_instruction),
    );

    solana_logger::setup_with_default(RUST_LOG_DEFAULT);

    let market_keypair: Keypair = Keypair::new();

    let context: Rc<RefCell<ProgramTestContext>> =
        Rc::new(RefCell::new(program_test.start_with_context().await));

    // Be careful. There are 2 payers. The one on the context that will shortly be created and this one. We dont just use the
    //let payer_keypair: Keypair = Keypair::new();
    //let payer: &Pubkey = &payer_keypair.pubkey();
    let payer_keypair: Keypair = context.borrow().payer.insecure_clone();
    let payer: &Pubkey = &payer_keypair.pubkey();

    // For this test, usdc is old token and spl is token22.
    let usdc_mint_f: MintFixture =
        MintFixture::new_with_version(Rc::clone(&context), Some(6), true).await;
    // Does not need to use extensions.
    let spl_mint_f: MintFixture =
        MintFixture::new_with_version(Rc::clone(&context), Some(9), false).await;
    let usdc_mint_key: Pubkey = usdc_mint_f.key;
    let spl_mint_key: Pubkey = spl_mint_f.key;

    // Create the market with SPL as base which is normal, USDC as quote which is 2022.
    let create_market_ixs: Vec<Instruction> = create_market_instructions(
        &market_keypair.pubkey(),
        &spl_mint_f.key,
        &usdc_mint_f.key,
        payer,
    )
    .unwrap();
    send_tx_with_retry(
        Rc::clone(&context),
        &create_market_ixs[..],
        Some(&payer),
        &[&payer_keypair.insecure_clone(), &market_keypair],
    )
    .await?;

    // Claim seats
    let claim_seat_ix: Instruction = claim_seat_instruction(&market_keypair.pubkey(), &payer);
    send_tx_with_retry(
        Rc::clone(&context),
        &[claim_seat_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Create depositor token accounts
    let usdc_token_account_keypair: Keypair = Keypair::new();
    let spl_token_account_keypair: Keypair = Keypair::new();
    let rent: Rent = context.borrow_mut().banks_client.get_rent().await.unwrap();
    let create_spl_token_account_ix: Instruction = create_account(
        payer,
        &spl_token_account_keypair.pubkey(),
        rent.minimum_balance(spl_token::state::Account::LEN),
        spl_token::state::Account::LEN as u64,
        &spl_token::id(),
    );
    let init_spl_token_account_ix: Instruction = spl_token::instruction::initialize_account(
        &spl_token::id(),
        &spl_token_account_keypair.pubkey(),
        &spl_mint_key,
        payer,
    )
    .unwrap();
    let create_usdc_token_account_ix: Instruction = create_account(
        payer,
        &usdc_token_account_keypair.pubkey(),
        rent.minimum_balance(spl_token_2022::state::Account::LEN),
        spl_token_2022::state::Account::LEN as u64,
        &spl_token_2022::id(),
    );
    let init_usdc_token_account_ix: Instruction = spl_token_2022::instruction::initialize_account(
        &spl_token_2022::id(),
        &usdc_token_account_keypair.pubkey(),
        &usdc_mint_key,
        payer,
    )
    .unwrap();
    send_tx_with_retry(
        Rc::clone(&context),
        &[
            create_spl_token_account_ix,
            init_spl_token_account_ix,
            create_usdc_token_account_ix,
            init_usdc_token_account_ix,
        ],
        Some(&payer),
        &[
            &payer_keypair.insecure_clone(),
            &spl_token_account_keypair.insecure_clone(),
            &usdc_token_account_keypair.insecure_clone(),
        ],
    )
    .await?;

    // Add funds to those token accounts.
    let spl_mint_to_instruction: Instruction = spl_token::instruction::mint_to(
        &spl_token::ID,
        &spl_mint_key,
        &spl_token_account_keypair.pubkey(),
        &payer,
        &[&payer],
        1_000_000_000_000_000,
    )
    .unwrap();
    let usdc_mint_to_instruction: Instruction = spl_token_2022::instruction::mint_to(
        &spl_token_2022::ID,
        &usdc_mint_key,
        &usdc_token_account_keypair.pubkey(),
        &payer,
        &[&payer],
        1_000_000_000_000_000,
    )
    .unwrap();
    send_tx_with_retry(
        Rc::clone(&context),
        &[spl_mint_to_instruction, usdc_mint_to_instruction],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Call deposit for each token account for a partial amount so we can swap later.
    let deposit_spl_ix: Instruction = deposit_instruction(
        &market_keypair.pubkey(),
        &payer,
        &spl_mint_key,
        1_000_000_000,
        &spl_token_account_keypair.pubkey(),
        spl_token::id(),
        None,
    );
    let deposit_usdc_ix: Instruction = deposit_instruction(
        &market_keypair.pubkey(),
        &payer,
        &usdc_mint_key,
        1_000_000_000,
        &usdc_token_account_keypair.pubkey(),
        spl_token_2022::id(),
        None,
    );
    send_tx_with_retry(
        Rc::clone(&context),
        &[deposit_spl_ix, deposit_usdc_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Call withdraw
    let withdraw_spl_ix: Instruction = withdraw_instruction(
        &market_keypair.pubkey(),
        &payer,
        &spl_mint_key,
        1_000,
        &spl_token_account_keypair.pubkey(),
        spl_token::id(),
        None,
    );
    let withdraw_usdc_ix: Instruction = withdraw_instruction(
        &market_keypair.pubkey(),
        &payer,
        &usdc_mint_key,
        1_000,
        &usdc_token_account_keypair.pubkey(),
        spl_token_2022::id(),
        None,
    );
    send_tx_with_retry(
        Rc::clone(&context),
        &[withdraw_spl_ix, withdraw_usdc_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Place orders on both sides to
    let place_order_ix: Instruction = batch_update_instruction(
        &market_keypair.pubkey(),
        &payer,
        None,
        vec![],
        vec![
            PlaceOrderParams::new(
                1_000,
                9,
                -1,
                true,
                OrderType::PostOnly,
                NO_EXPIRATION_LAST_VALID_SLOT,
            ),
            PlaceOrderParams::new(
                1_000,
                11,
                -1,
                false,
                OrderType::PostOnly,
                NO_EXPIRATION_LAST_VALID_SLOT,
            ),
        ],
        None,
        None,
        None,
        None,
    );
    send_tx_with_retry(
        Rc::clone(&context),
        &[place_order_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    // Swap using both directions
    let swap_base_in_ix: Instruction = swap_instruction(
        &market_keypair.pubkey(),
        &payer,
        &spl_mint_key,
        &usdc_mint_key,
        &spl_token_account_keypair.pubkey(),
        &usdc_token_account_keypair.pubkey(),
        100,
        10,
        true,
        true,
        spl_token::id(),
        spl_token_2022::id(),
        false,
    );
    let swap_base_out_ix: Instruction = swap_instruction(
        &market_keypair.pubkey(),
        &payer,
        &spl_mint_key,
        &usdc_mint_key,
        &spl_token_account_keypair.pubkey(),
        &usdc_token_account_keypair.pubkey(),
        100,
        10,
        false,
        true,
        spl_token::id(),
        spl_token_2022::id(),
        false,
    );
    send_tx_with_retry(
        Rc::clone(&context),
        &[swap_base_in_ix, swap_base_out_ix],
        Some(&payer),
        &[&payer_keypair.insecure_clone()],
    )
    .await?;

    Ok(())
}
