use crate::{TestFixture, Token, SOL_UNIT_SIZE};

#[tokio::test]
async fn basic_deposit_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    // Deposit also does a mint to user token account.
    test_fixture.deposit(Token::SOL, SOL_UNIT_SIZE).await?;

    Ok(())
}
