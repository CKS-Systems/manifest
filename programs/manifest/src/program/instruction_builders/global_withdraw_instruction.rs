use crate::{
    program::{global_withdraw::GlobalWithdrawParams, ManifestInstruction},
    validation::{get_global_address, get_global_vault_address},
};
use borsh::BorshSerialize;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;

pub fn global_withdraw_instruction(
    mint: &Pubkey,
    payer: &Pubkey,
    trader_token_account: &Pubkey,
    token_program: &Pubkey,
    num_atoms: u64,
) -> Instruction {
    let (global, _global_bump) = get_global_address(&mint.to_bytes());
    let (global_vault, _global_vault_bump) = get_global_vault_address(&mint.to_bytes());
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new_readonly(Pubkey::from(*payer), true),
            AccountMeta::new(Pubkey::from(global), false),
            AccountMeta::new_readonly(Pubkey::from(*mint), false),
            AccountMeta::new(Pubkey::from(global_vault), false),
            AccountMeta::new(Pubkey::from(*trader_token_account), false),
            AccountMeta::new_readonly(Pubkey::from(*token_program), false),
        ],
        data: [
            ManifestInstruction::GlobalWithdraw.to_vec(),
            GlobalWithdrawParams::new(num_atoms).try_to_vec().unwrap(),
        ]
        .concat(),
    }
}
