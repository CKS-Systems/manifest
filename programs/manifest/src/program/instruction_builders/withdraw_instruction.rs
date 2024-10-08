use crate::{
    program::{withdraw::WithdrawParams, ManifestInstruction},
    validation::get_vault_address,
};
use borsh::BorshSerialize;
use hypertree::DataIndex;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

pub fn withdraw_instruction(
    market: &Pubkey,
    payer: &Pubkey,
    mint: &Pubkey,
    amount_atoms: u64,
    trader_token_account: &Pubkey,
    token_program: Pubkey,
    trader_index_hint: Option<DataIndex>,
) -> Instruction {
    let (vault_address, _) = get_vault_address(market, mint);

    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*market, false),
            AccountMeta::new(*trader_token_account, false),
            AccountMeta::new(vault_address, false),
            AccountMeta::new_readonly(token_program, false),
            AccountMeta::new_readonly(*mint, false),
        ],
        data: [
            ManifestInstruction::Withdraw.to_vec(),
            WithdrawParams::new(amount_atoms, trader_index_hint)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    }
}
