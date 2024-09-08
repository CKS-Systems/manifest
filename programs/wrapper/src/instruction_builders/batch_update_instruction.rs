use crate::{
    instruction::ManifestWrapperInstruction,
    processors::batch_upate::{
        WrapperBatchUpdateParams, WrapperCancelOrderParams, WrapperPlaceOrderParams,
    },
};
use borsh::BorshSerialize;
use hypertree::DataIndex;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

pub fn batch_update_instruction(
    market: &Pubkey,
    payer: &Pubkey,
    wrapper_state: &Pubkey,
    cancels: Vec<WrapperCancelOrderParams>,
    cancel_all: bool,
    orders: Vec<WrapperPlaceOrderParams>,
    trader_index_hint: Option<DataIndex>,
) -> Instruction {
    Instruction {
        program_id: crate::id(),
        accounts: vec![
            AccountMeta::new(*wrapper_state, false),
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(*payer, true),
            AccountMeta::new(*market, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: [
            ManifestWrapperInstruction::BatchUpdate.to_vec(),
            WrapperBatchUpdateParams::new(cancels, cancel_all, orders, trader_index_hint)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    }
}
