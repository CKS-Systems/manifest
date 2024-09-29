use crate::ManifestWrapperInstruction;
use borsh::BorshSerialize;
use manifest::{program::deposit::DepositParams, validation::get_vault_address};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

pub fn deposit_instruction(
    market: &Pubkey,
    owner: &Pubkey,
    mint: &Pubkey,
    amount_atoms: u64,
    trader_token_account: &Pubkey,
    wrapper_state: &Pubkey,
    token_program: Pubkey,
) -> Instruction {
    let (vault_address, _) = get_vault_address(market, mint);
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(*owner, true),
            AccountMeta::new(*market, false),
            AccountMeta::new(*trader_token_account, false),
            AccountMeta::new(vault_address, false),
            AccountMeta::new(token_program, false),
            AccountMeta::new(*wrapper_state, false),
            AccountMeta::new(*mint, false),
        ],
        data: [
            ManifestWrapperInstruction::Deposit.to_vec(),
            DepositParams::new(amount_atoms).try_to_vec().unwrap(),
        ]
        .concat(),
    }
}
