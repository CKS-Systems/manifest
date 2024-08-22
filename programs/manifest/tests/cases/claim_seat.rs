use solana_program_test::tokio;

use crate::TestFixture;

#[tokio::test]
async fn claim_seat() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    // Success
    test_fixture.claim_seat().await?;

    Ok(())
}

#[tokio::test]
async fn claim_seat_again_fail() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    // Should not be able to claim a second seat
    assert!(test_fixture.claim_seat().await.is_err());

    Ok(())
}

#[tokio::test]
async fn claim_seat_different_user() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    // Should succeed. It was funded with infinite lamports.
    test_fixture
        .claim_seat_for_keypair(&test_fixture.second_keypair)
        .await?;

    Ok(())
}
