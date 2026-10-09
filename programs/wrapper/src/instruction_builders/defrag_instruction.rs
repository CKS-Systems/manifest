use crate::ManifestWrapperInstruction;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

/// Compact and shrink a wrapper account. `authority` must sign and be either
/// the wrapper's owner or the hardcoded collector. Compose with Collect to
/// sweep the freed rent in the same transaction.
pub fn defrag_instruction(wrapper_state: &Pubkey, authority: &Pubkey) -> Instruction {
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new(*wrapper_state, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data: ManifestWrapperInstruction::Defrag.to_vec(),
    }
}
