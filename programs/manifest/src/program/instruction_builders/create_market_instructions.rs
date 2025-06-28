use crate::{
    program::ManifestInstruction, validation::{get_vault_address, get_market_address}, ProgramError,
};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

/// Helper function for clients to get the market PDA address
pub fn get_market_pubkey(
    base_mint: &Pubkey,
    quote_mint: &Pubkey,
) -> Pubkey {
    let (market, _bump) = get_market_address(base_mint, quote_mint);
    market
}

/// Creates the market PDA and populates it with data.
pub fn create_market_instructions(
    base_mint: &Pubkey,
    quote_mint: &Pubkey,
    market_creator: &Pubkey,
) -> Result<Vec<Instruction>, ProgramError> {
    let (market, _market_bump) = get_market_address(base_mint, quote_mint);
    
    Ok(vec![
        create_market_instruction(&market, base_mint, quote_mint, market_creator),
    ])
}

pub fn create_market_instruction(
    market: &Pubkey,
    base_mint: &Pubkey,
    quote_mint: &Pubkey,
    market_creator: &Pubkey,
) -> Instruction {
    let (base_vault, _) = get_vault_address(market, base_mint);
    let (quote_vault, _) = get_vault_address(market, quote_mint);
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new(*market_creator, true),
            AccountMeta::new(*market, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(*base_mint, false),
            AccountMeta::new_readonly(*quote_mint, false),
            AccountMeta::new(base_vault, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(spl_token_2022::id(), false),
        ],
        data: [ManifestInstruction::CreateMarket.to_vec()].concat(),
    }
}
