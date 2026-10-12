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
use solana_program_test::{tokio, BanksClientError};
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use solana_transaction::{InstructionError, TransactionError};
use wrapper::{
    instruction::ManifestWrapperInstruction, instruction_builders::defrag_instruction,
    processors::batch_upate::WrapperCancelOrderParams,
};

use crate::{send_tx_with_retry, TestFixture, Token, SOL_UNIT_SIZE};

use super::sync::{ask, wrapper_account, wrapper_batch, wrapper_view};

async fn defrag_as(
    test_fixture: &TestFixture,
    authority: &Keypair,
    limit: Option<u32>,
) -> Result<(), BanksClientError> {
    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[defrag_instruction(
            &test_fixture.wrapper.key,
            &authority.pubkey(),
            limit,
        )],
        Some(&payer),
        &[&payer_keypair, authority],
    )
    .await
}

#[tokio::test]
async fn defrag_compacts_shrinks_and_keeps_the_wrapper_usable() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, 6 * SOL_UNIT_SIZE).await?;
    wrapper_batch(
        &test_fixture,
        vec![],
        vec![ask(1, 2), ask(2, 3), ask(3, 4), ask(4, 5), ask(5, 6)],
    )
    .await?;
    // Cancel around the survivors so compaction has to move both survivors
    // past holes, and so that one bounded run cannot finish the job.
    wrapper_batch(
        &test_fixture,
        vec![
            WrapperCancelOrderParams::new(1),
            WrapperCancelOrderParams::new(3),
            WrapperCancelOrderParams::new(5),
        ],
        vec![],
    )
    .await?;
    let before: Account = wrapper_account(&test_fixture).await;

    // Only the owner or the collector may run it: the authority check itself
    // rejects the imposter, not some incidental transaction failure.
    let imposter: Keypair = Keypair::new();
    assert_eq!(
        defrag_as(&test_fixture, &imposter, None)
            .await
            .unwrap_err()
            .unwrap(),
        TransactionError::InstructionError(0, InstructionError::InvalidArgument)
    );

    // A budget of one relocation still makes progress: it truncates what it
    // freed and leaves the rest for the next run.
    let collector: Keypair = Keypair::new_from_array([42; 32]);
    defrag_as(&test_fixture, &collector, Some(1)).await?;
    let partial: Account = wrapper_account(&test_fixture).await;
    assert!(
        partial.data.len() < before.data.len(),
        "a bounded defrag run must shrink the account: {} -> {}",
        before.data.len(),
        partial.data.len()
    );

    // The test-feature collector, the same keypair the collect tests use.
    defrag_as(&test_fixture, &collector, None).await?;

    let after: Account = wrapper_account(&test_fixture).await;
    assert!(
        after.data.len() < partial.data.len(),
        "defrag must shrink the account: {} -> {}",
        partial.data.len(),
        after.data.len()
    );
    // No lamports move: the freed rent stays on the account as excess.
    assert_eq!(after.lamports, before.lamports);

    // Every entry survived: the open orders are still tracked and usable.
    let (_, orders) = wrapper_view(&test_fixture).await;
    let mut ids: Vec<u64> = orders.iter().map(|(id, _)| *id).collect();
    ids.sort();
    assert_eq!(ids, vec![2, 4]);
    wrapper_batch(
        &test_fixture,
        vec![WrapperCancelOrderParams::new(2)],
        vec![ask(9, 5)],
    )
    .await?;
    let (_, orders) = wrapper_view(&test_fixture).await;
    let mut ids: Vec<u64> = orders.iter().map(|(id, _)| *id).collect();
    ids.sort();
    assert_eq!(ids, vec![4, 9]);

    // The owner may run it too; the batch above reused the freed block, so
    // the account is still packed and the run is a no-op.
    let owner: Keypair = test_fixture.payer_keypair().insecure_clone();
    let compacted_len: usize = wrapper_account(&test_fixture).await.data.len();
    defrag_as(&test_fixture, &owner, None).await?;
    assert_eq!(
        wrapper_account(&test_fixture).await.data.len(),
        compacted_len
    );

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
