use solana_program_test::tokio;

use crate::TestFixture;

#[tokio::test]
async fn claim_seat() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    Ok(())
}
