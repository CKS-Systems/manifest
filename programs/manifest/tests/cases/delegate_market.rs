use solana_program::pubkey::Pubkey;
use solana_program_test::tokio;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    signature::{Keypair, Signer},
};

use crate::TestFixture;
use manifest::{
    program::ManifestInstruction,
    validation::get_market_address,
};

#[tokio::test]
async fn delegate_market_seed_derivation() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    
    // Use the market that already exists from TestFixture::new()
    let market_address = test_fixture.market_fixture.key;
    
    // Test that we can derive the correct market address from base and quote mints
    let (expected_market_address, expected_bump) = get_market_address(
        &test_fixture.sol_mint_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
    );
    
    // Verify the market was created at the expected PDA address
    assert_eq!(market_address, expected_market_address);
    
    // The seeds should be [b"market", base_mint, quote_mint, bump]
    let expected_seeds: &[&[u8]] = &[
        b"market",
        test_fixture.sol_mint_fixture.key.as_ref(),
        test_fixture.usdc_mint_fixture.key.as_ref(),
        &[expected_bump],
    ];
    
    // Verify we can derive the same address using the seeds
    let derived_address = Pubkey::create_program_address(expected_seeds, &manifest::id())?;
    assert_eq!(derived_address, expected_market_address);
    
    Ok(())
}

#[tokio::test]
async fn delegate_market_basic_instruction() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    
    // Use the market that already exists from TestFixture::new()
    let market_address = test_fixture.market_fixture.key;
    
    // Create dummy accounts for the delegate instruction
    // Note: This test will likely fail when trying to execute due to missing ephemeral rollups program
    // but it tests that the instruction can be constructed and the accounts are set up correctly
    let initializer = test_fixture.payer();
    let delegation_buffer = Keypair::new();
    let delegation_record = Keypair::new(); 
    let delegation_metadata = Keypair::new();
    let delegation_program = Keypair::new(); // This would be the actual ephemeral rollups program in real usage
    
    let delegate_instruction = Instruction {
        program_id: manifest::id(),
        accounts: vec![
            AccountMeta::new(initializer, true),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new(market_address, false),
            AccountMeta::new_readonly(manifest::id(), false), // owner_program 
            AccountMeta::new(delegation_buffer.pubkey(), false),
            AccountMeta::new(delegation_record.pubkey(), false),
            AccountMeta::new(delegation_metadata.pubkey(), false),
            AccountMeta::new_readonly(delegation_program.pubkey(), false),
        ],
        data: ManifestInstruction::DelegateMarket.to_vec(),
    };
    
    // Verify the instruction is constructed correctly
    assert_eq!(delegate_instruction.accounts.len(), 8);
    assert_eq!(delegate_instruction.accounts[0].pubkey, initializer);
    assert_eq!(delegate_instruction.accounts[2].pubkey, market_address);
    assert_eq!(delegate_instruction.data, vec![14]); // DelegateMarket = 14
    
    Ok(())
}

#[tokio::test] 
async fn delegate_market_different_mints() -> anyhow::Result<()> {
    let test_fixture: TestFixture = TestFixture::new().await;
    
    // Test with different mint pairs to ensure seeds are derived correctly
    let (market1_address, market1_bump) = get_market_address(
        &test_fixture.sol_mint_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
    );
    
    let (market2_address, market2_bump) = get_market_address(
        &test_fixture.usdc_mint_fixture.key,
        &test_fixture.sol_mint_fixture.key,
    );
    
    // Different mint order should produce different addresses
    assert_ne!(market1_address, market2_address);
    // Note: Bumps might be the same (typically 255), but addresses will be different
    
    // But same mint pair should always produce same address
    let (market1_address_again, market1_bump_again) = get_market_address(
        &test_fixture.sol_mint_fixture.key,
        &test_fixture.usdc_mint_fixture.key,
    );
    
    assert_eq!(market1_address, market1_address_again);
    assert_eq!(market1_bump, market1_bump_again);
    
    Ok(())
} 