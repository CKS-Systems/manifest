use std::{mem::size_of, rc::Rc};

use borsh::BorshSerialize;
use hypertree::{get_helper, DataIndex, HyperTreeReadOperations, RBNode, NIL};
use manifest::state::{constants::NO_EXPIRATION_LAST_VALID_SLOT, OrderType};
use solana_program::{instruction::AccountMeta, system_program};
use solana_program_test::tokio;
use solana_sdk::{
    account::Account, instruction::Instruction, pubkey::Pubkey, signature::Keypair, signer::Signer,
};
use ui_wrapper::{
    self,
    instruction::ManifestWrapperInstruction,
    market_info::MarketInfo,
    processors::{place_order::WrapperPlaceOrderParams, shared::MarketInfosTree},
    wrapper_state::ManifestWrapperStateFixed,
};

use crate::{send_tx_with_retry, TestFixture, Token, SOL_UNIT_SIZE, USDC_UNIT_SIZE};

#[tokio::test]
async fn wrapper_place_order_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();

    let place_order_ix = Instruction {
        program_id: ui_wrapper::id(),
        accounts: vec![
            AccountMeta::new(test_fixture.wrapper.key, false),
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer, true),
            AccountMeta::new(test_fixture.market.key, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: [
            ManifestWrapperInstruction::PlaceOrder.to_vec(),
            WrapperPlaceOrderParams::new(
                0,
                1,
                1,
                0,
                true,
                NO_EXPIRATION_LAST_VALID_SLOT,
                OrderType::Limit,
            )
            .try_to_vec()
            .unwrap(),
        ]
        .concat(),
    };
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[place_order_ix],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    Ok(())
}
