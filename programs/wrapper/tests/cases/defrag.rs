//! Wrapper defrag: compaction keeps every entry, shrinks the account, and the
//! freed rent becomes excess for Collect. Callable by the owner and by the
//! hardcoded collector, and by no one else.

use std::rc::Rc;

use solana_account::Account;
use solana_keypair::Keypair;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    rent::Rent,
};
use solana_program_test::tokio;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use wrapper::{
    instruction::ManifestWrapperInstruction,
    instruction_builders::{batch_update_instruction, defrag_instruction},
    processors::batch_upate::{WrapperCancelOrderParams, WrapperPlaceOrderParams},
};

use manifest::state::{constants::NO_EXPIRATION_LAST_VALID_SLOT, OrderType};

use crate::{send_tx_with_retry, TestFixture, Token, SOL_UNIT_SIZE};

use super::sync::wrapper_view;

fn ask(client_order_id: u64, price_mantissa: u32) -> WrapperPlaceOrderParams {
    WrapperPlaceOrderParams::new(
        client_order_id,
        SOL_UNIT_SIZE,
        price_mantissa,
        -3,
        false,
        NO_EXPIRATION_LAST_VALID_SLOT,
        OrderType::Limit,
    )
}

async fn wrapper_account(test_fixture: &TestFixture) -> Account {
    test_fixture
        .context
        .borrow_mut()
        .banks_client
        .get_account(test_fixture.wrapper.key)
        .await
        .expect("Fetch wrapper")
        .expect("Wrapper is not none")
}

async fn wrapper_batch(
    test_fixture: &TestFixture,
    cancels: Vec<WrapperCancelOrderParams>,
    orders: Vec<WrapperPlaceOrderParams>,
) -> anyhow::Result<()> {
    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let instruction: Instruction = batch_update_instruction(
        &test_fixture.market.key,
        &payer,
        &test_fixture.wrapper.key,
        cancels,
        false,
        orders,
    );
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[instruction],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;
    Ok(())
}

async fn defrag_as(test_fixture: &TestFixture, authority: &Keypair) -> anyhow::Result<()> {
    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[defrag_instruction(
            &test_fixture.wrapper.key,
            &authority.pubkey(),
        )],
        Some(&payer),
        &[&payer_keypair, authority],
    )
    .await?;
    Ok(())
}

#[tokio::test]
async fn defrag_compacts_shrinks_and_keeps_the_wrapper_usable() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, 5 * SOL_UNIT_SIZE).await?;
    wrapper_batch(&test_fixture, vec![], vec![ask(1, 2), ask(2, 3), ask(3, 4)]).await?;
    // Cancel around the survivor so compaction has to move it past holes.
    wrapper_batch(
        &test_fixture,
        vec![
            WrapperCancelOrderParams::new(1),
            WrapperCancelOrderParams::new(3),
        ],
        vec![],
    )
    .await?;
    let before: Account = wrapper_account(&test_fixture).await;

    // Only the owner or the collector may run it.
    let imposter: Keypair = Keypair::new();
    assert!(defrag_as(&test_fixture, &imposter).await.is_err());

    // The test-feature collector, the same keypair the collect tests use.
    let collector: Keypair = Keypair::new_from_array([42; 32]);
    defrag_as(&test_fixture, &collector).await?;

    let after: Account = wrapper_account(&test_fixture).await;
    assert!(
        after.data.len() < before.data.len(),
        "defrag must shrink the account: {} -> {}",
        before.data.len(),
        after.data.len()
    );
    // No lamports move: the freed rent stays on the account as excess.
    assert_eq!(after.lamports, before.lamports);

    // Every entry survived: the open order is still tracked and usable.
    let (_, orders) = wrapper_view(&test_fixture).await;
    assert_eq!(orders.len(), 1);
    assert_eq!(orders[0].0, 2);
    wrapper_batch(
        &test_fixture,
        vec![WrapperCancelOrderParams::new(2)],
        vec![ask(9, 5)],
    )
    .await?;
    let (_, orders) = wrapper_view(&test_fixture).await;
    assert_eq!(orders.len(), 1);
    assert_eq!(orders[0].0, 9);

    // The owner may run it too, and a compacted wrapper stays compacted.
    let owner: Keypair = test_fixture.payer_keypair().insecure_clone();
    defrag_as(&test_fixture, &owner).await?;

    // Collect sweeps everything above the new, smaller minimum.
    let swept: Account = wrapper_account(&test_fixture).await;
    let minimum: u64 = Rent::default().minimum_balance(swept.data.len());
    assert!(swept.lamports > minimum, "freed rent waits as excess");
    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let collect: Instruction = Instruction {
        program_id: wrapper::id(),
        accounts: vec![
            AccountMeta::new(test_fixture.wrapper.key, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new(collector.pubkey(), true),
        ],
        data: ManifestWrapperInstruction::Collect.to_vec(),
    };
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[collect],
        Some(&payer),
        &[&payer_keypair, &collector],
    )
    .await?;
    let collected: Account = wrapper_account(&test_fixture).await;
    assert_eq!(collected.lamports, minimum);
    Ok(())
}
