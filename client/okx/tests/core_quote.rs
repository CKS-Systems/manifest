use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD, Engine};
use manifest::{
    quantities::{BaseAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{
        AddOrderToMarketArgs, MarketFixed, MarketValue, OrderType, MARKET_BLOCK_SIZE,
        NO_EXPIRATION_LAST_VALID_SLOT,
    },
    validation::get_global_address,
};
use manifest_okx::{mfx::Manifest, QuoteSnapshot, SwapDirection};
use solana_account::Account;
use solana_client::{rpc_client::RpcClient, rpc_request::RpcRequest};
use solana_program::{program_pack::Pack, pubkey::Pubkey};
use spl_token_2022::{
    extension::{
        transfer_fee::TransferFeeConfig, BaseStateWithExtensionsMut, ExtensionType,
        StateWithExtensionsMut,
    },
    state::Mint,
};

type Accounts = HashMap<Pubkey, Account>;

fn mint(decimals: u8) -> Account {
    let mut data = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            decimals,
            is_initialized: true,
            ..Mint::default()
        },
        &mut data,
    )
    .unwrap();
    Account {
        data,
        owner: spl_token::id(),
        ..Account::default()
    }
}

fn encoded(market: &MarketValue) -> Account {
    let mut data = bytemuck::bytes_of(&market.fixed).to_vec();
    data.extend_from_slice(&market.dynamic);
    Account {
        data,
        owner: manifest::ID,
        ..Account::default()
    }
}

fn book(bid: bool, orders: &[(u64, u32, i8, u32)]) -> (Pubkey, Accounts, Account) {
    let key = Pubkey::new_unique();
    let base = Pubkey::new_unique();
    let quote = Pubkey::new_unique();
    let mut market = MarketValue {
        fixed: MarketFixed::new_empty_from_mint_parts(
            &base,
            0,
            &quote,
            0,
            Pubkey::new_unique(),
            0,
            Pubkey::new_unique(),
            0,
        ),
        dynamic: vec![0; MARKET_BLOCK_SIZE * 8],
    };
    market.market_expand_n(8).unwrap();
    let empty = encoded(&market);
    let maker = Pubkey::new_unique();
    market.claim_seat(&maker).unwrap();
    let trader_index = market.get_trader_index(&maker);
    for &(amount, mantissa, exponent, last_valid_slot) in orders {
        let price =
            QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(mantissa, exponent).unwrap();
        let funding = if bid {
            price
                .checked_quote_for_base(BaseAtoms::new(amount), true)
                .unwrap()
                .as_u64()
        } else {
            amount
        };
        market.deposit(trader_index, funding, !bid).unwrap();
        market
            .place_order(AddOrderToMarketArgs {
                market: &key,
                trader_index,
                num_base_atoms: BaseAtoms::new(amount),
                price,
                is_bid: bid,
                last_valid_slot,
                order_type: OrderType::Limit,
                global_trade_accounts_opts: &[None, None],
                current_slot: Some(1),
            })
            .unwrap();
    }
    (
        key,
        HashMap::from([(key, encoded(&market)), (base, mint(0)), (quote, mint(0))]),
        empty,
    )
}

#[test]
fn original_price_resolves_the_indicative_rounding_difference() {
    let (key, accounts, _) = book(false, &[(3, 15, -1, NO_EXPIRATION_LAST_VALID_SLOT)]);
    let snapshot = QuoteSnapshot::from_accounts(key, 10, &accounts).unwrap();
    assert_eq!(
        Manifest
            .quote_atoms(3, &snapshot, SwapDirection::QuoteToBase)
            .unwrap(),
        2
    );
    assert_eq!(
        Manifest
            .quote_atoms(0, &snapshot, SwapDirection::QuoteToBase)
            .unwrap(),
        0
    );
}

#[test]
fn all_u64_atoms_are_preserved_without_a_float_conversion() {
    for bid in [false, true] {
        let (key, accounts, _) = book(bid, &[(u64::MAX, 1, 0, 0)]);
        let before = accounts.clone();
        let snapshot = QuoteSnapshot::from_accounts(key, 10, &accounts).unwrap();
        let direction = if bid {
            SwapDirection::BaseToQuote
        } else {
            SwapDirection::QuoteToBase
        };
        for amount in [1, (1_u64 << 53) + 1, u64::MAX - 1, u64::MAX] {
            assert_eq!(
                Manifest.quote_atoms(amount, &snapshot, direction).unwrap(),
                amount
            );
        }
        assert_eq!(snapshot.slot(), 10);
        assert_eq!(snapshot.market_address(), key);
        assert_eq!(accounts, before);
    }
}

#[test]
fn expiration_uses_the_supplied_snapshot_slot() {
    let (key, accounts, _) = book(true, &[(2, 2, 0, 5), (2, 1, 0, 0)]);
    let live = QuoteSnapshot::from_accounts(key, 4, &accounts).unwrap();
    let expired = QuoteSnapshot::from_accounts(key, 6, &accounts).unwrap();
    assert_eq!(
        Manifest
            .quote_atoms(2, &live, SwapDirection::BaseToQuote)
            .unwrap(),
        4
    );
    assert_eq!(
        Manifest
            .quote_atoms(2, &expired, SwapDirection::BaseToQuote)
            .unwrap(),
        2
    );
    assert!(QuoteSnapshot::from_accounts(key, u64::from(u32::MAX) + 1, &accounts).is_err());
}

#[test]
fn malformed_market_mint_and_global_accounts_are_rejected() {
    let (key, accounts, _) = book(true, &[(2, 2, 0, 0)]);
    let mut missing = accounts.clone();
    missing.remove(&key);
    assert!(QuoteSnapshot::from_accounts(key, 10, &missing).is_err());
    for length in [0, 1, 255] {
        let mut invalid = accounts.clone();
        invalid.get_mut(&key).unwrap().data.truncate(length);
        assert!(QuoteSnapshot::from_accounts(key, 10, &invalid).is_err());
    }
    let mut invalid = accounts.clone();
    invalid.get_mut(&key).unwrap().owner = spl_token::id();
    assert!(QuoteSnapshot::from_accounts(key, 10, &invalid).is_err());
    let mint_key = *accounts
        .keys()
        .find(|&&candidate| candidate != key)
        .unwrap();
    let mut invalid = accounts.clone();
    invalid.insert(mint_key, mint(9));
    assert!(QuoteSnapshot::from_accounts(key, 10, &invalid).is_err());
    let mut invalid = accounts.clone();
    invalid.get_mut(&mint_key).unwrap().owner = Pubkey::new_unique();
    assert!(QuoteSnapshot::from_accounts(key, 10, &invalid).is_err());
    let mut invalid = accounts.clone();
    invalid.insert(get_global_address(&mint_key).0, Account::default());
    assert!(QuoteSnapshot::from_accounts(key, 10, &invalid).is_err());
}

#[test]
fn fee_mints_are_explicitly_rejected_instead_of_quoted_as_fee_free() {
    let (key, mut accounts, _) = book(true, &[(2, 2, 0, 0)]);
    let mint_key = *accounts
        .keys()
        .find(|&&candidate| candidate != key)
        .unwrap();
    let mut data =
        vec![
            0;
            ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferFeeConfig])
                .unwrap()
        ];
    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();
    state.init_extension::<TransferFeeConfig>(true).unwrap();
    state.base = Mint {
        is_initialized: true,
        ..Mint::default()
    };
    state.pack_base();
    state.init_account_type().unwrap();
    accounts.insert(
        mint_key,
        Account {
            data,
            owner: spl_token_2022::id(),
            ..Account::default()
        },
    );
    let error = match QuoteSnapshot::from_accounts(key, 10, &accounts) {
        Ok(_) => panic!("fee mint accepted"),
        Err(error) => error,
    };
    assert!(error.to_string().contains("transfer-fee"));
}

fn rpc_account(account: &Account) -> serde_json::Value {
    serde_json::json!({"lamports":account.lamports,"owner":account.owner.to_string(),"executable":account.executable,"rentEpoch":0,"data":[STANDARD.encode(&account.data),"base64"],"space":account.data.len()})
}

#[test]
fn rpc_fetch_keeps_only_the_final_common_slot_response() {
    let (key, accounts, empty) = book(false, &[(3, 15, -1, 0)]);
    let raw = manifest::program::get_dynamic_value_or::<MarketFixed>(&accounts[&key].data).unwrap();
    let keys = [
        key,
        *raw.get_base_mint(),
        *raw.get_quote_mint(),
        get_global_address(raw.get_base_mint()).0,
        get_global_address(raw.get_quote_mint()).0,
    ];
    let values: Vec<_> = keys
        .iter()
        .map(|key| accounts.get(key).map(rpc_account))
        .collect();
    let mocks = HashMap::from([
        (
            RpcRequest::GetAccountInfo,
            serde_json::json!({"context":{"slot":10},"value":rpc_account(&empty)}),
        ),
        (
            RpcRequest::GetMultipleAccounts,
            serde_json::json!({"context":{"slot":17},"value":values}),
        ),
    ]);
    let client = RpcClient::new_mock_with_mocks("succeeds", mocks);
    let snapshot = Manifest.fetch_quote_snapshot(&client, &key).unwrap();
    assert_eq!(snapshot.slot(), 17);
    assert_eq!(
        Manifest
            .quote_atoms(3, &snapshot, SwapDirection::QuoteToBase)
            .unwrap(),
        2
    );
}

#[test]
fn rpc_fetch_rejects_stale_incomplete_and_unreadable_responses() {
    let (key, accounts, empty) = book(false, &[(3, 15, -1, 0)]);
    let raw = manifest::program::get_dynamic_value_or::<MarketFixed>(&accounts[&key].data).unwrap();
    let keys = [
        key,
        *raw.get_base_mint(),
        *raw.get_quote_mint(),
        get_global_address(raw.get_base_mint()).0,
        get_global_address(raw.get_quote_mint()).0,
    ];
    let values: Vec<_> = keys
        .iter()
        .map(|key| accounts.get(key).map(rpc_account))
        .collect();
    let mut corrupt = values.clone();
    corrupt[0].as_mut().unwrap()["data"] = serde_json::json!(["not base64!", "base64"]);
    for (slot, response) in [
        (9, values.clone()),
        (17, values[..2].to_vec()),
        (17, corrupt),
    ] {
        let mocks = HashMap::from([
            (
                RpcRequest::GetAccountInfo,
                serde_json::json!({"context":{"slot":10},"value":rpc_account(&empty)}),
            ),
            (
                RpcRequest::GetMultipleAccounts,
                serde_json::json!({"context":{"slot":slot},"value":response}),
            ),
        ]);
        assert!(Manifest
            .fetch_quote_snapshot(&RpcClient::new_mock_with_mocks("succeeds", mocks), &key)
            .is_err());
    }
}

#[test]
fn fee_free_token_program_pairs_use_the_same_integer_quote() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<QuoteSnapshot>();
    for bid in [false, true] {
        for base22 in [false, true] {
            for quote22 in [false, true] {
                let (key, mut accounts, _) = book(bid, &[(8, 2, 0, 0)]);
                let market =
                    manifest::program::get_dynamic_value_or::<MarketFixed>(&accounts[&key].data)
                        .unwrap();
                if base22 {
                    accounts.get_mut(market.get_base_mint()).unwrap().owner = spl_token_2022::id();
                }
                if quote22 {
                    accounts.get_mut(market.get_quote_mint()).unwrap().owner = spl_token_2022::id();
                }
                let snapshot = QuoteSnapshot::from_accounts(key, 10, &accounts).unwrap();
                assert_eq!(
                    Manifest
                        .quote_atoms(
                            if bid { 4 } else { 8 },
                            &snapshot,
                            if bid {
                                SwapDirection::BaseToQuote
                            } else {
                                SwapDirection::QuoteToBase
                            }
                        )
                        .unwrap(),
                    if bid { 8 } else { 4 }
                );
            }
        }
    }
}

#[test]
fn active_transfer_hooks_are_explicitly_rejected() {
    use spl_token_2022::extension::transfer_hook::TransferHook;
    let (key, mut accounts, _) = book(true, &[(2, 2, 0, 0)]);
    let mint_key = *accounts
        .keys()
        .find(|&&candidate| candidate != key)
        .unwrap();
    let mut data =
        vec![
            0;
            ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferHook])
                .unwrap()
        ];
    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();
    state
        .init_extension::<TransferHook>(true)
        .unwrap()
        .program_id = Some(Pubkey::new_unique()).try_into().unwrap();
    state.base = Mint {
        is_initialized: true,
        ..Mint::default()
    };
    state.pack_base();
    state.init_account_type().unwrap();
    accounts.insert(
        mint_key,
        Account {
            data,
            owner: spl_token_2022::id(),
            ..Account::default()
        },
    );
    let error = match QuoteSnapshot::from_accounts(key, 10, &accounts) {
        Ok(_) => panic!("active hook accepted"),
        Err(error) => error,
    };
    assert!(error.to_string().contains("transfer hooks"));
}
