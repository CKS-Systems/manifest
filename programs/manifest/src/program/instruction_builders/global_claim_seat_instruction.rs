use crate::program::ManifestInstruction;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

pub fn global_claim_seat_instruction(
    global: &Pubkey,
    payer: &Pubkey,
    market: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*global, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new(*market, false),
        ],
        data: [ManifestInstruction::GlobalClaimSeat.to_vec()].concat(),
    }
}
