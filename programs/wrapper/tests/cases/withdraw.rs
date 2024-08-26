use crate::{TestFixture, Token, SOL_UNIT_SIZE};

#[tokio::test]
async fn basic_withdraw_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    test_fixture.deposit(Token::SOL, SOL_UNIT_SIZE).await?;
    test_fixture.withdraw(Token::SOL, SOL_UNIT_SIZE).await?;

    Ok(())
}
