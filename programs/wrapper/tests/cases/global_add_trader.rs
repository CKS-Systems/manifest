use solana_program_test::tokio;

use crate::TestFixture;

#[tokio::test]
async fn global_add_trader() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.global_add_trader().await?;

    Ok(())
}
