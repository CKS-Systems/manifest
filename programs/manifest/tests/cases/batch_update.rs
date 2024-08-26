use manifest::{
    program::batch_update::{CancelOrderParams, PlaceOrderParams},
    state::{OrderType, BLOCK_SIZE, NO_EXPIRATION_LAST_VALID_SLOT},
};
use solana_program_test::tokio;

use crate::{TestFixture, Token, SOL_UNIT_SIZE, USDC_UNIT_SIZE};

#[tokio::test]
async fn batch_update_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture.deposit(Token::SOL, 1 * SOL_UNIT_SIZE).await?;

    // First uses the trader hint, second does not.
    test_fixture
        .batch_update_for_keypair(
            Some(0),
            vec![],
            vec![PlaceOrderParams::new(
                1 * SOL_UNIT_SIZE,
                1,
                0,
                false,
                OrderType::Limit,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair(),
        )
        .await?;

    test_fixture
        .batch_update_for_keypair(
            None,
            vec![CancelOrderParams::new(0)],
            vec![PlaceOrderParams::new(
                1 * SOL_UNIT_SIZE,
                1,
                0,
                false,
                OrderType::Limit,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair(),
        )
        .await?;

    // Hinted cancel
    test_fixture
        .batch_update_for_keypair(
            Some(0),
            vec![CancelOrderParams::new_with_hint(
                0,
                Some((BLOCK_SIZE * 1).try_into().unwrap()),
            )],
            vec![],
            &test_fixture.payer_keypair(),
        )
        .await?;

    Ok(())
}

#[tokio::test]
async fn batch_update_fill_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;
    test_fixture
        .deposit(Token::SOL, 1_000 * SOL_UNIT_SIZE)
        .await?;
    test_fixture
        .deposit(Token::USDC, 1_000 * USDC_UNIT_SIZE)
        .await?;

    test_fixture
        .batch_update_for_keypair(
            None,
            vec![],
            vec![PlaceOrderParams::new(
                1 * SOL_UNIT_SIZE,
                1,
                0,
                false,
                OrderType::Limit,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair(),
        )
        .await?;

    test_fixture
        .batch_update_for_keypair(
            None,
            vec![CancelOrderParams::new(0)],
            vec![PlaceOrderParams::new(
                1 * SOL_UNIT_SIZE,
                1,
                0,
                true,
                OrderType::Limit,
                NO_EXPIRATION_LAST_VALID_SLOT,
            )],
            &test_fixture.payer_keypair(),
        )
        .await?;

    Ok(())
}
