use crate::ManifestWrapperInstruction;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

/// Compact and shrink a wrapper account. `authority` must sign and be either
/// the wrapper's owner or the hardcoded collector. `limit` optionally bounds
/// how many blocks the run relocates (clamped on chain to
/// `MAX_WRAPPER_DEFRAG_RELOCATIONS_PER_RUN`); a wrapper too fragmented for
/// one transaction is compacted by repeating a bounded run until the account
/// stops shrinking. Compose with Collect to sweep the freed rent in the same
/// transaction.
pub fn defrag_instruction(
    wrapper_state: &Pubkey,
    authority: &Pubkey,
    limit: Option<u32>,
) -> Instruction {
    let mut data: Vec<u8> = ManifestWrapperInstruction::Defrag.to_vec();
    if let Some(limit) = limit {
        data.extend_from_slice(&limit.to_le_bytes());
    }
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new(*wrapper_state, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}
