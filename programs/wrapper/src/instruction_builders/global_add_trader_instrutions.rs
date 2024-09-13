use crate::ManifestWrapperInstruction;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

pub fn global_add_trader_instruction(
    global: &Pubkey,
    owner: &Pubkey,
    wrapper_state: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(*owner, true),
            AccountMeta::new(*global, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new(*wrapper_state, false),
        ],
        data: [ManifestWrapperInstruction::GlobalAddTrader.to_vec()].concat(),
    }
}