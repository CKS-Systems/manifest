use std::{rc::Rc, str::FromStr};

use borsh::BorshSerialize;
use hypertree::{
    get_helper, trace, DataIndex, HyperTreeReadOperations, HyperTreeValueIteratorTrait, RBNode,
    RedBlackTreeTestHelpers, NIL,
};
use manifest::{
    quantities::QuoteAtomsPerBaseAtom,
    state::{constants::NO_EXPIRATION_LAST_VALID_SLOT, OrderType, RestingOrder},
    validation::get_vault_address,
};
use solana_program::{instruction::AccountMeta, system_program};
use solana_program_test::tokio;
use solana_sdk::{
    account::Account, instruction::Instruction, program_pack::Pack, pubkey::Pubkey,
    signature::Keypair, signer::Signer,
};
use spl_token;
use ui_wrapper::{
    self,
    instruction::ManifestWrapperInstruction,
    instruction_builders::{claim_seat_instruction, create_wrapper_instructions},
    market_info::MarketInfo,
    open_order::WrapperOpenOrder,
    processors::{
        cancel_order::WrapperCancelOrderParams,
        place_order::WrapperPlaceOrderParams,
        settle_funds::WrapperSettleFundsParams,
        shared::{MarketInfosTreeReadOnly, OpenOrdersTreeReadOnly},
    },
};

use crate::{send_tx_with_retry, TestFixture, Token, WrapperFixture};

#[tokio::test]
async fn wrapper_place_order_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;
    test_fixture.claim_seat().await?;

    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let (base_mint, trader_token_account_base) = test_fixture
        .fund_trader_wallet(&payer_keypair, Token::SOL, 1)
        .await;
    let (quote_mint, trader_token_account_quote) = test_fixture
        .fund_trader_wallet(&payer_keypair, Token::USDC, 1)
        .await;

    let platform_token_account = test_fixture.fund_token_account(&quote_mint, &payer).await;
    let referred_token_account = test_fixture.fund_token_account(&quote_mint, &payer).await;
    let (base_vault, _) = get_vault_address(&test_fixture.market.key, &base_mint);

    let (quote_vault, _) = get_vault_address(&test_fixture.market.key, &quote_mint);

    trace!(
        "market:{:?} mint:{quote_mint:?} vault:{quote_vault:?}",
        test_fixture.market.key
    );

    // place order
    let place_order_ix = Instruction {
        program_id: ui_wrapper::id(),
        accounts: vec![
            AccountMeta::new(test_fixture.wrapper.key, false),
            AccountMeta::new(payer, true),
            AccountMeta::new(trader_token_account_quote, false),
            AccountMeta::new(test_fixture.market.key, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(quote_mint, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer, true),
        ],
        data: [
            ManifestWrapperInstruction::PlaceOrder.to_vec(),
            WrapperPlaceOrderParams::new(
                1,
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

    // verify order is on book
    test_fixture.market.reload().await;
    let trader_index = test_fixture.market.market.get_trader_index(&payer);

    let asks = test_fixture.market.market.get_asks();
    asks.debug_print::<RestingOrder>();

    let bids = test_fixture.market.market.get_bids();
    bids.debug_print::<RestingOrder>();
    let found: Option<(DataIndex, &RestingOrder)> = bids
        .iter::<RestingOrder>()
        .find(|(_, o)| o.get_trader_index() == trader_index);
    assert!(found.is_some());
    let (core_index, order) = found.unwrap();
    assert_eq!(order.get_is_bid(), true);
    assert_eq!(order.get_num_base_atoms(), 1);

    // verify order is correctly tracked on wrapper
    test_fixture.wrapper.reload().await;

    trace!("wrapper_fixed:{:?}", test_fixture.wrapper.wrapper.fixed);

    let open_order: WrapperOpenOrder = {
        let market_infos_tree: MarketInfosTreeReadOnly = MarketInfosTreeReadOnly::new(
            &test_fixture.wrapper.wrapper.dynamic,
            test_fixture.wrapper.wrapper.fixed.market_infos_root_index,
            NIL,
        );

        let market_info_index: DataIndex =
            market_infos_tree.lookup_index(&MarketInfo::new_empty(test_fixture.market.key, NIL));

        let market_info: &MarketInfo = get_helper::<RBNode<MarketInfo>>(
            &test_fixture.wrapper.wrapper.dynamic,
            market_info_index,
        )
        .get_value();

        get_helper::<RBNode<WrapperOpenOrder>>(
            &test_fixture.wrapper.wrapper.dynamic,
            market_info.orders_root_index,
        )
        .get_value()
        .clone()
    };

    trace!("open_order:{open_order:?}");

    assert_eq!(open_order.get_is_bid(), true);
    assert_eq!(open_order.get_client_order_id(), 1);
    assert_eq!(open_order.get_num_base_atoms(), 1);
    assert_eq!(
        open_order.get_price(),
        QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(1, 0).unwrap()
    );
    assert_eq!(open_order.get_market_data_index(), core_index);

    // cancel the same order

    let cancel_order_ix = Instruction {
        program_id: ui_wrapper::id(),
        accounts: vec![
            AccountMeta::new(test_fixture.wrapper.key, false),
            AccountMeta::new(payer, true),
            AccountMeta::new(trader_token_account_quote, false),
            AccountMeta::new(test_fixture.market.key, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(quote_mint, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(manifest::id(), false),
        ],
        data: [
            ManifestWrapperInstruction::CancelOrder.to_vec(),
            WrapperCancelOrderParams::new(1).try_to_vec().unwrap(),
        ]
        .concat(),
    };
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[cancel_order_ix],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    // verify order is no longer on book
    test_fixture.market.reload().await;
    let trader_index = test_fixture.market.market.get_trader_index(&payer);

    let asks = test_fixture.market.market.get_asks();
    asks.debug_print::<RestingOrder>();

    let bids = test_fixture.market.market.get_bids();
    bids.debug_print::<RestingOrder>();
    let found: Option<(DataIndex, &RestingOrder)> = bids
        .iter::<RestingOrder>()
        .find(|(_, o)| o.get_trader_index() == trader_index);
    assert!(found.is_none());

    // verify order is no longer tracked on wrapper
    test_fixture.wrapper.reload().await;

    trace!("wrapper_fixed:{:?}", test_fixture.wrapper.wrapper.fixed);

    let market_info_index: DataIndex = {
        let market_infos_tree: MarketInfosTreeReadOnly = MarketInfosTreeReadOnly::new(
            &test_fixture.wrapper.wrapper.dynamic,
            test_fixture.wrapper.wrapper.fixed.market_infos_root_index,
            NIL,
        );
        market_infos_tree.lookup_index(&MarketInfo::new_empty(test_fixture.market.key, NIL))
    };

    let orders_root_index = {
        let market_info: &MarketInfo = get_helper::<RBNode<MarketInfo>>(
            &test_fixture.wrapper.wrapper.dynamic,
            market_info_index,
        )
        .get_value();

        market_info.orders_root_index
    };

    let open_orders_tree: OpenOrdersTreeReadOnly = OpenOrdersTreeReadOnly::new(
        &test_fixture.wrapper.wrapper.dynamic,
        orders_root_index,
        NIL,
    );
    let found = open_orders_tree
        .iter::<WrapperOpenOrder>()
        .find(|(_, o)| o.get_client_order_id() == 1);
    assert!(found.is_none());

    // release funds
    let settle_funds_ix = Instruction {
        program_id: ui_wrapper::id(),
        accounts: vec![
            AccountMeta::new(test_fixture.wrapper.key, false),
            AccountMeta::new(payer, true),
            AccountMeta::new(trader_token_account_base, false),
            AccountMeta::new(trader_token_account_quote, false),
            AccountMeta::new(test_fixture.market.key, false),
            AccountMeta::new(base_vault, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(base_mint, false),
            AccountMeta::new_readonly(quote_mint, false),
            AccountMeta::new_readonly(
                Pubkey::from_str("EXECM4wjzdCnrtQjHx5hy1r5k31tdvWBPYbqsjSoPfAh").unwrap(),
                false,
            ),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer, true),
            AccountMeta::new(platform_token_account, false),
            AccountMeta::new(referred_token_account, false),
        ],
        data: [
            ManifestWrapperInstruction::SettleFunds.to_vec(),
            WrapperSettleFundsParams::new(1_000_000_000, 50)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    };
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[settle_funds_ix],
        Some(&payer),
        &[&payer_keypair],
    )
    .await?;

    // verify no fees were charged and user has deposit back in his wallet
    let trader_token_account_quote: Account = test_fixture
        .context
        .borrow_mut()
        .banks_client
        .get_account(trader_token_account_quote)
        .await
        .unwrap()
        .unwrap();

    let trader_token_account_quote =
        spl_token::state::Account::unpack(&trader_token_account_quote.data)?;
    assert_eq!(trader_token_account_quote.amount, 1);

    Ok(())
}

#[tokio::test]
async fn wrapper_place_order_with_broke_owner_test() -> anyhow::Result<()> {
    let mut test_fixture: TestFixture = TestFixture::new().await;

    let payer: Pubkey = test_fixture.payer();
    let payer_keypair: Keypair = test_fixture.payer_keypair().insecure_clone();
    let owner: Pubkey = test_fixture.second_keypair.pubkey();
    let owner_keypair: Keypair = test_fixture.second_keypair.insecure_clone();

    // setup wrapper for owner
    let mut wrapper_fixture: WrapperFixture = {
        let wrapper_keypair = Keypair::new();

        let create_wrapper_ixs: Vec<Instruction> =
            create_wrapper_instructions(&payer, &owner, &wrapper_keypair.pubkey()).unwrap();

        send_tx_with_retry(
            Rc::clone(&test_fixture.context),
            &create_wrapper_ixs,
            Some(&payer),
            &[&payer_keypair, &owner_keypair, &wrapper_keypair],
        )
        .await
        .unwrap();
    

        let claim_seat_ix: Instruction = claim_seat_instruction(
            &test_fixture.market.key,
            &payer,
            &owner,
            &wrapper_keypair.pubkey(),
        );

        println!("market:{:?}", test_fixture.market.key);
        println!("payer:{:?}", payer);
        println!("owner:{:?}", owner);
        println!("wrapper:{:?}", wrapper_keypair.pubkey());

        send_tx_with_retry(
            Rc::clone(&test_fixture.context),
            &[claim_seat_ix],
            Some(&payer),
            &[&payer_keypair, &owner_keypair],
        )
        .await
        .unwrap();
        /*
               create_wrapper_ixs.push(claim_seat_ix);
               send_tx_with_retry(
                   Rc::clone(&test_fixture.context),
                   &create_wrapper_ixs,
                   Some(&payer),
                   &[&payer_keypair, &owner_keypair, &wrapper_keypair],
               )
               .await
               .unwrap();
        */
        WrapperFixture::new(Rc::clone(&test_fixture.context), wrapper_keypair.pubkey()).await
    };

    let (base_mint, trader_token_account_base) = test_fixture
        .fund_trader_wallet(&owner_keypair, Token::SOL, 0)
        .await;
    let (quote_mint, trader_token_account_quote) = test_fixture
        .fund_trader_wallet(&owner_keypair, Token::USDC, 1)
        .await;

    let platform_token_account = test_fixture.fund_token_account(&quote_mint, &payer).await;
    let referred_token_account = test_fixture.fund_token_account(&quote_mint, &payer).await;
    let (base_vault, _) = get_vault_address(&test_fixture.market.key, &base_mint);

    let (quote_vault, _) = get_vault_address(&test_fixture.market.key, &quote_mint);

    trace!(
        "market:{:?} mint:{quote_mint:?} vault:{quote_vault:?}",
        test_fixture.market.key
    );

    // place order
    let place_order_ix = Instruction {
        program_id: ui_wrapper::id(),
        accounts: vec![
            AccountMeta::new(wrapper_fixture.key, false),
            AccountMeta::new(owner, true),
            AccountMeta::new(trader_token_account_quote, false),
            AccountMeta::new(test_fixture.market.key, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(quote_mint, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer, true),
        ],
        data: [
            ManifestWrapperInstruction::PlaceOrder.to_vec(),
            WrapperPlaceOrderParams::new(
                1,
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
        &[&payer_keypair, &owner_keypair],
    )
    .await?;

    // verify order is on book
    test_fixture.market.reload().await;
    let trader_index = test_fixture.market.market.get_trader_index(&owner);

    let asks = test_fixture.market.market.get_asks();
    asks.debug_print::<RestingOrder>();

    let bids = test_fixture.market.market.get_bids();
    bids.debug_print::<RestingOrder>();
    let found: Option<(DataIndex, &RestingOrder)> = bids
        .iter::<RestingOrder>()
        .find(|(_, o)| o.get_trader_index() == trader_index);
    assert!(found.is_some());
    let (core_index, order) = found.unwrap();
    assert_eq!(order.get_is_bid(), true);
    assert_eq!(order.get_num_base_atoms(), 1);

    // verify order is correctly tracked on wrapper
    wrapper_fixture.reload().await;

    trace!("wrapper_fixed:{:?}", wrapper_fixture.wrapper.fixed);

    let open_order: WrapperOpenOrder = {
        let market_infos_tree: MarketInfosTreeReadOnly = MarketInfosTreeReadOnly::new(
            &wrapper_fixture.wrapper.dynamic,
            wrapper_fixture.wrapper.fixed.market_infos_root_index,
            NIL,
        );

        let market_info_index: DataIndex =
            market_infos_tree.lookup_index(&MarketInfo::new_empty(test_fixture.market.key, NIL));

        let market_info: &MarketInfo =
            get_helper::<RBNode<MarketInfo>>(&wrapper_fixture.wrapper.dynamic, market_info_index)
                .get_value();

        get_helper::<RBNode<WrapperOpenOrder>>(
            &wrapper_fixture.wrapper.dynamic,
            market_info.orders_root_index,
        )
        .get_value()
        .clone()
    };

    trace!("open_order:{open_order:?}");

    assert_eq!(open_order.get_is_bid(), true);
    assert_eq!(open_order.get_client_order_id(), 1);
    assert_eq!(open_order.get_num_base_atoms(), 1);
    assert_eq!(
        open_order.get_price(),
        QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(1, 0).unwrap()
    );
    assert_eq!(open_order.get_market_data_index(), core_index);

    // cancel the same order

    let cancel_order_ix = Instruction {
        program_id: ui_wrapper::id(),
        accounts: vec![
            AccountMeta::new(wrapper_fixture.key, false),
            AccountMeta::new(owner, true),
            AccountMeta::new(trader_token_account_quote, false),
            AccountMeta::new(test_fixture.market.key, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(quote_mint, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(manifest::id(), false),
        ],
        data: [
            ManifestWrapperInstruction::CancelOrder.to_vec(),
            WrapperCancelOrderParams::new(1).try_to_vec().unwrap(),
        ]
        .concat(),
    };
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[cancel_order_ix],
        Some(&payer),
        &[&payer_keypair, &owner_keypair],
    )
    .await?;

    // verify order is no longer on book
    test_fixture.market.reload().await;
    let trader_index = test_fixture.market.market.get_trader_index(&payer);

    let asks = test_fixture.market.market.get_asks();
    asks.debug_print::<RestingOrder>();

    let bids = test_fixture.market.market.get_bids();
    bids.debug_print::<RestingOrder>();
    let found: Option<(DataIndex, &RestingOrder)> = bids
        .iter::<RestingOrder>()
        .find(|(_, o)| o.get_trader_index() == trader_index);
    assert!(found.is_none());

    // verify order is no longer tracked on wrapper
    wrapper_fixture.reload().await;

    trace!("wrapper_fixed:{:?}", wrapper_fixture.wrapper.fixed);

    let market_info_index: DataIndex = {
        let market_infos_tree: MarketInfosTreeReadOnly = MarketInfosTreeReadOnly::new(
            &wrapper_fixture.wrapper.dynamic,
            wrapper_fixture.wrapper.fixed.market_infos_root_index,
            NIL,
        );
        market_infos_tree.lookup_index(&MarketInfo::new_empty(test_fixture.market.key, NIL))
    };

    let orders_root_index = {
        let market_info: &MarketInfo =
            get_helper::<RBNode<MarketInfo>>(&wrapper_fixture.wrapper.dynamic, market_info_index)
                .get_value();

        market_info.orders_root_index
    };

    let open_orders_tree: OpenOrdersTreeReadOnly =
        OpenOrdersTreeReadOnly::new(&wrapper_fixture.wrapper.dynamic, orders_root_index, NIL);
    let found = open_orders_tree
        .iter::<WrapperOpenOrder>()
        .find(|(_, o)| o.get_client_order_id() == 1);
    assert!(found.is_none());

    // release funds
    let settle_funds_ix = Instruction {
        program_id: ui_wrapper::id(),
        accounts: vec![
            AccountMeta::new(wrapper_fixture.key, false),
            AccountMeta::new(owner, true),
            AccountMeta::new(trader_token_account_base, false),
            AccountMeta::new(trader_token_account_quote, false),
            AccountMeta::new(test_fixture.market.key, false),
            AccountMeta::new(base_vault, false),
            AccountMeta::new(quote_vault, false),
            AccountMeta::new_readonly(base_mint, false),
            AccountMeta::new_readonly(quote_mint, false),
            AccountMeta::new_readonly(
                Pubkey::from_str("EXECM4wjzdCnrtQjHx5hy1r5k31tdvWBPYbqsjSoPfAh").unwrap(),
                false,
            ),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(manifest::id(), false),
            AccountMeta::new(payer, true),
            AccountMeta::new(platform_token_account, false),
            AccountMeta::new(referred_token_account, false),
        ],
        data: [
            ManifestWrapperInstruction::SettleFunds.to_vec(),
            WrapperSettleFundsParams::new(1_000_000_000, 50)
                .try_to_vec()
                .unwrap(),
        ]
        .concat(),
    };
    send_tx_with_retry(
        Rc::clone(&test_fixture.context),
        &[settle_funds_ix],
        Some(&payer),
        &[&payer_keypair, &owner_keypair],
    )
    .await?;

    // verify no fees were charged and user has deposit back in his wallet
    let trader_token_account_quote: Account = test_fixture
        .context
        .borrow_mut()
        .banks_client
        .get_account(trader_token_account_quote)
        .await
        .unwrap()
        .unwrap();

    let trader_token_account_quote =
        spl_token::state::Account::unpack(&trader_token_account_quote.data)?;
    assert_eq!(trader_token_account_quote.amount, 1);

    Ok(())
}

// TODO: test fee payment only if std::env::var("BPF_OUT_DIR").is_ok() || std::env::var("SBF_OUT_DIR").is_ok();
