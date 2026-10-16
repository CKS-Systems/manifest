use crate::{program::ManifestInstruction, validation::get_vault_address};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

/// Relocation budget only, reclaiming every empty seat.
pub fn defrag_instruction(
    market: &Pubkey,
    collector: &Pubkey,
    base_mint: &Pubkey,
    quote_mint: &Pubkey,
    base_token_program: Pubkey,
    quote_token_program: Pubkey,
    // Nodes relocated in this run. `None` is unbounded; `Some(0)` relocates
    // nothing and only reclaims.
    limit: Option<u32>,
) -> Instruction {
    defrag_instruction_configured(
        market,
        collector,
        base_mint,
        quote_mint,
        base_token_program,
        quote_token_program,
        limit,
        None,
        false,
    )
}

/// Budgets each step separately. `relocations` caps nodes moved, `seat_limit`
/// caps empty seats reclaimed; `None` is unbounded and `Some(0)` disables that
/// step, so `(Some(0), Some(0))` collects excess lamports and truncates the
/// existing free tail without touching an entry or invalidating an index.
///
/// `may_close` permits the one irreversible step: retiring a market that
/// compacts to nothing, closing its vaults and destroying its address. Leave
/// it false unless that is the intent of this particular run; emptiness is a
/// snapshot, and a live market whose maker has pulled every quote looks the
/// same as an abandoned one.
pub fn defrag_instruction_configured(
    market: &Pubkey,
    collector: &Pubkey,
    base_mint: &Pubkey,
    quote_mint: &Pubkey,
    base_token_program: Pubkey,
    quote_token_program: Pubkey,
    relocations: Option<u32>,
    seat_limit: Option<u32>,
    may_close: bool,
) -> Instruction {
    let mut data: Vec<u8> = vec![ManifestInstruction::Defrag as u8];
    // Each field needs the ones ahead of it, so an unbounded budget paired
    // with a later field is encoded as the explicit maximum.
    if may_close {
        data.extend_from_slice(&relocations.unwrap_or(u32::MAX).to_le_bytes());
        data.extend_from_slice(&seat_limit.unwrap_or(u32::MAX).to_le_bytes());
        data.push(1);
    } else if let Some(seat_limit) = seat_limit {
        data.extend_from_slice(&relocations.unwrap_or(u32::MAX).to_le_bytes());
        data.extend_from_slice(&seat_limit.to_le_bytes());
    } else if let Some(relocations) = relocations {
        data.extend_from_slice(&relocations.to_le_bytes());
    }
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new(*collector, true),
            AccountMeta::new(*market, false),
            AccountMeta::new(get_vault_address(market, base_mint).0, false),
            AccountMeta::new(get_vault_address(market, quote_mint).0, false),
            AccountMeta::new_readonly(base_token_program, false),
            AccountMeta::new_readonly(quote_token_program, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
        ],
        data,
    }
}
