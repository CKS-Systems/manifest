use std::cell::{Ref, RefCell};

use solana_program::{pubkey::Pubkey, rent::Rent};
use solana_program_test::ProgramTestContext;
use solana_sdk::{
    instruction::Instruction, program_pack::Pack,
    signature::Keypair, signer::Signer, system_instruction::create_account,
};
use std::rc::Rc;

use crate::sender::send_tx_with_retry;


#[derive(Clone)]
pub struct MintFixture {
    pub context: Rc<RefCell<ProgramTestContext>>,
    pub key: Pubkey,
}

impl MintFixture {
    pub async fn new(
        context: Rc<RefCell<ProgramTestContext>>,
        mint_keypair: Option<Keypair>,
        mint_decimals: Option<u8>,
    ) -> MintFixture {
        let payer_pubkey: Pubkey = context.borrow().payer.pubkey();
        let payer: Keypair = context.borrow().payer.insecure_clone();

        let mint_keypair: Keypair = mint_keypair.unwrap_or_else(Keypair::new);

        let rent: Rent = context.borrow_mut().banks_client.get_rent().await.unwrap();

        let init_account_ix: Instruction = create_account(
            &context.borrow().payer.pubkey(),
            &mint_keypair.pubkey(),
            rent.minimum_balance(spl_token::state::Mint::LEN),
            spl_token::state::Mint::LEN as u64,
            &spl_token::id(),
        );
        let init_mint_ix: Instruction = spl_token::instruction::initialize_mint(
            &spl_token::id(),
            &mint_keypair.pubkey(),
            &context.borrow().payer.pubkey(),
            None,
            mint_decimals.unwrap_or(6),
        )
        .unwrap();

        send_tx_with_retry(
            Rc::clone(&context),
            &[init_account_ix, init_mint_ix],
            Some(&payer_pubkey),
            &[&mint_keypair.insecure_clone(), &payer],
        )
        .await
        .unwrap();

        let context_ref: Rc<RefCell<ProgramTestContext>> = Rc::clone(&context);
        MintFixture {
            context: context_ref,
            key: mint_keypair.pubkey(),
        }
    }

    pub async fn mint_to(&mut self, dest: &Pubkey, native_amount: u64) {
        let payer_keypair: Keypair = self.context.borrow().payer.insecure_clone();
        let mint_to_ix: Instruction = self.make_mint_to_ix(dest, native_amount);
        send_tx_with_retry(
            Rc::clone(&self.context),
            &[mint_to_ix],
            Some(&payer_keypair.pubkey()),
            &[&payer_keypair],
        )
        .await
        .unwrap();
    }

    fn make_mint_to_ix(&self, dest: &Pubkey, amount: u64) -> Instruction {
        let context: Ref<ProgramTestContext> = self.context.borrow();
        let mint_to_instruction: Instruction = spl_token::instruction::mint_to(
            &spl_token::ID,
            &self.key,
            dest,
            &context.payer.pubkey(),
            &[&context.payer.pubkey()],
            amount,
        )
        .unwrap();
        mint_to_instruction
    }
}
