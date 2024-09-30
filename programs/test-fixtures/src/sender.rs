use std::{
    cell::{RefCell, RefMut},
    io::Error,
};

use solana_program::{hash::Hash, pubkey::Pubkey};
use solana_program_test::{BanksClientError, ProgramTestContext};
use solana_sdk::{
    instruction::Instruction,
    signature::Keypair,
    transaction::Transaction,
};
use std::rc::Rc;

pub async fn send_tx_with_retry(
    context: Rc<RefCell<ProgramTestContext>>,
    instructions: &[Instruction],
    payer: Option<&Pubkey>,
    signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let mut context: RefMut<ProgramTestContext> = context.borrow_mut();

    loop {
        let blockhash_or: Result<Hash, Error> = context.get_new_latest_blockhash().await;
        if blockhash_or.is_err() {
            continue;
        }
        let tx: Transaction =
            Transaction::new_signed_with_payer(instructions, payer, signers, blockhash_or.unwrap());
        let result: Result<(), BanksClientError> =
            context.banks_client.process_transaction(tx).await;
        if result.is_ok() {
            break;
        }
        let error: BanksClientError = result.err().unwrap();
        match error {
            BanksClientError::RpcError(_rpc_err) => {
                // Retry on rpc errors.
                continue;
            }
            BanksClientError::Io(_io_err) => {
                // Retry on io errors.
                continue;
            }
            _ => {
                println!("Unexpected error: {:?}", error);
                return Err(error);
            }
        }
    }
    Ok(())
}
