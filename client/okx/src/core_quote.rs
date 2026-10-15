//! Integer book quotes from a validated, immutable account snapshot.

use std::{
    cell::Cell,
    collections::{HashMap, HashSet},
    mem::size_of,
};

use anyhow::{bail, ensure, Context, Result};
use hypertree::{
    validate_red_black_tree, GetRedBlackTreeReadOnlyData, HyperTreeValueIteratorTrait,
};
use manifest::{
    quantities::{BaseAtoms, QuoteAtoms, WrapperU64},
    state::{
        claimed_seat::ClaimedSeat, validate_global_dynamic, GlobalFixed, MarketFixed, MarketValue,
        OrderType, RestingOrder,
    },
    validation::{
        get_global_address, loaders::GlobalTradeAccounts, ManifestAccount, ManifestAccountInfo,
        MintAccountInfo, OwnedAccount, TokenProgram,
    },
};
use solana_account::Account;
use solana_account_decoder::UiAccountEncoding;
use solana_client::{rpc_client::RpcClient, rpc_config::RpcAccountInfoConfig};
use solana_program::pubkey::Pubkey;
use spl_token_2022::{
    extension::{
        transfer_fee::TransferFeeConfig, transfer_hook::TransferHook, BaseStateWithExtensions,
        StateWithExtensions,
    },
    state::Mint,
};

use crate::{mfx::Manifest, SwapDirection};

/// One validated bank snapshot. Fields are private so later account updates
/// cannot combine orders, precision fields or Global balances from different
/// versions. `from_accounts` requires the caller to supply a coherent snapshot;
/// `fetch_quote_snapshot` fetches all quote accounts in one final RPC response.
#[derive(Clone)]
pub struct QuoteSnapshot {
    key: Pubkey,
    slot: u64,
    market: MarketValue,
    mints: [Account; 2],
    globals: [Option<Account>; 2],
}

fn market_value(account: &Account) -> Result<MarketValue> {
    ensure!(account.owner == manifest::ID, "market has an invalid owner");
    ensure!(
        account.data.len() >= size_of::<MarketFixed>(),
        "market header is truncated"
    );
    let (header, dynamic) = account.data.split_at(size_of::<MarketFixed>());
    let fixed = *bytemuck::try_from_bytes::<MarketFixed>(header)
        .map_err(|error| anyhow::anyhow!("invalid market header: {error}"))?;
    fixed
        .verify_discriminant()
        .map_err(|error| anyhow::anyhow!("invalid market: {error}"))?;
    let market = MarketValue {
        fixed,
        dynamic: dynamic.to_vec(),
    };
    let seats = market.get_claimed_seats();
    validate_red_black_tree::<ClaimedSeat>(&market.dynamic, seats.root_index(), seats.max_index())
        .map_err(anyhow::Error::msg)?;
    let seat_indices: HashSet<_> = seats
        .iter::<ClaimedSeat>()
        .map(|(index, _)| index)
        .collect();
    for book in [market.get_bids(), market.get_asks()] {
        validate_red_black_tree::<RestingOrder>(
            &market.dynamic,
            book.root_index(),
            book.max_index(),
        )
        .map_err(anyhow::Error::msg)?;
        for (_, order) in book.iter::<RestingOrder>() {
            ensure!(order.has_valid_order_type(), "invalid order type");
            ensure!(
                seat_indices.contains(&order.get_trader_index()),
                "order references an invalid trader"
            );
        }
    }
    market
        .fixed
        .validate_free_list(&market.dynamic)
        .map_err(anyhow::Error::msg)?;
    Ok(market)
}

fn validate_mint(account: &Account, decimals: u8) -> Result<()> {
    ensure!(
        account.owner == spl_token::id() || account.owner == spl_token_2022::id(),
        "invalid mint owner"
    );
    let mint = StateWithExtensions::<Mint>::unpack(&account.data)
        .map_err(|error| anyhow::anyhow!("invalid mint: {error}"))?;
    ensure!(
        mint.base.decimals == decimals,
        "mint decimals differ from the market"
    );
    // Fee/hook-aware wallet quotes need additional epoch and account handling.
    // Reject them rather than silently returning a gross amount as a net quote.
    ensure!(
        mint.get_extension::<TransferFeeConfig>().is_err(),
        "transfer-fee mints are not supported by quote_atoms"
    );
    ensure!(
        !mint
            .get_extension::<TransferHook>()
            .is_ok_and(|hook| hook.program_id.get().is_some()),
        "active transfer hooks are not supported by quote_atoms"
    );
    Ok(())
}

fn validate_global(account: &Account, mint: Pubkey) -> Result<()> {
    ensure!(account.owner == manifest::ID, "Global has an invalid owner");
    ensure!(
        account.data.len() >= size_of::<GlobalFixed>(),
        "Global header is truncated"
    );
    let (header, dynamic) = account.data.split_at(size_of::<GlobalFixed>());
    let fixed = bytemuck::try_from_bytes::<GlobalFixed>(header)
        .map_err(|error| anyhow::anyhow!("invalid Global header: {error}"))?;
    fixed
        .verify_discriminant()
        .map_err(|error| anyhow::anyhow!("invalid Global: {error}"))?;
    ensure!(
        *fixed.get_mint() == mint,
        "Global mint does not match the market"
    );
    validate_global_dynamic(fixed, dynamic).map_err(anyhow::Error::msg)
}

impl QuoteSnapshot {
    /// Build from accounts at a common bank slot. The map must contain the
    /// market and both mints. Include the corresponding Global PDA accounts
    /// when quoting a side with active Global orders.
    pub fn from_accounts(
        key: Pubkey,
        slot: u64,
        accounts: &HashMap<Pubkey, Account>,
    ) -> Result<Self> {
        u32::try_from(slot).context("snapshot slot exceeds Core's supported range")?;
        let market = market_value(accounts.get(&key).context("market account is missing")?)?;
        let mint_keys = [*market.get_base_mint(), *market.get_quote_mint()];
        let mints = [
            accounts
                .get(&mint_keys[0])
                .context("base mint is missing")?
                .clone(),
            accounts
                .get(&mint_keys[1])
                .context("quote mint is missing")?
                .clone(),
        ];
        for (index, decimals) in [
            market.fixed.get_base_mint_decimals(),
            market.fixed.get_quote_mint_decimals(),
        ]
        .into_iter()
        .enumerate()
        {
            validate_mint(&mints[index], decimals)?;
        }
        let globals = mint_keys.map(|mint| accounts.get(&get_global_address(&mint).0).cloned());
        for (index, global) in globals.iter().enumerate() {
            if let Some(account) = global {
                validate_global(account, mint_keys[index])?;
            }
        }
        Ok(Self {
            key,
            slot,
            market,
            mints,
            globals,
        })
    }

    pub fn slot(&self) -> u64 {
        self.slot
    }
    pub fn market_address(&self) -> Pubkey {
        self.key
    }
}

impl Manifest {
    /// Fetch market, mints and Globals together. The initial read discovers
    /// immutable mint addresses; only the final common-slot response is kept.
    pub fn fetch_quote_snapshot(&self, client: &RpcClient, key: &Pubkey) -> Result<QuoteSnapshot> {
        let first = client.get_account_with_commitment(key, client.commitment())?;
        let initial = market_value(first.value.as_ref().context("market account is missing")?)?;
        let base = *initial.get_base_mint();
        let quote = *initial.get_quote_mint();
        let keys = [
            *key,
            base,
            quote,
            get_global_address(&base).0,
            get_global_address(&quote).0,
        ];
        let response = client.get_multiple_ui_accounts_with_config(
            &keys,
            RpcAccountInfoConfig {
                commitment: Some(client.commitment()),
                encoding: Some(UiAccountEncoding::Base64),
                min_context_slot: Some(first.context.slot),
                ..RpcAccountInfoConfig::default()
            },
        )?;
        ensure!(
            response.value.len() == keys.len(),
            "incomplete account response"
        );
        ensure!(
            response.context.slot >= first.context.slot,
            "RPC returned an older snapshot"
        );
        let mut accounts = HashMap::new();
        for (key, account) in keys.into_iter().zip(response.value) {
            if let Some(account) = account {
                accounts.insert(
                    key,
                    account
                        .to_account()
                        .context("RPC account decoding failed")?,
                );
            }
        }
        QuoteSnapshot::from_accounts(*key, response.context.slot, &accounts)
    }

    /// Quote exact-input integer atoms using Core's original order prices,
    /// expiration checks, Global backing checks and impact rounding.
    ///
    /// Returns output atoms, with partial liquidity handled as Core handles it.
    /// This is Core's read-only impact estimate, not a transaction simulation:
    /// account changes, capacity/expansion, shared Global funding across fills
    /// and transaction execution checks can still change or reject a fill.
    /// Transfer-fee mints and active transfer hooks are rejected at snapshot
    /// construction. The legacy `Dex::quote(f64, ...)` API is unchanged.
    pub fn quote_atoms(
        &self,
        amount_in: u64,
        snapshot: &QuoteSnapshot,
        direction: SwapDirection,
    ) -> Result<u64> {
        if amount_in == 0 {
            return Ok(0);
        }
        let (book, output_side) = match direction {
            SwapDirection::BaseToQuote => (snapshot.market.get_bids(), 1),
            SwapDirection::QuoteToBase => (snapshot.market.get_asks(), 0),
        };
        let slot = u32::try_from(snapshot.slot)?;
        if snapshot.globals[output_side].is_none()
            && book.iter::<RestingOrder>().any(|(_, order)| {
                order.get_order_type() == OrderType::Global && !order.is_expired(slot)
            })
        {
            bail!("Global account is required for this book side");
        }
        let mint_keys = [
            *snapshot.market.get_base_mint(),
            *snapshot.market.get_quote_mint(),
        ];
        let mint_owned = std::array::from_fn::<_, 2, _>(|index| {
            OwnedAccount::new(
                &mint_keys[index],
                &snapshot.mints[index].owner,
                snapshot.mints[index].lamports,
                &snapshot.mints[index].data,
            )
        });
        let program_owned = snapshot
            .mints
            .each_ref()
            .map(|mint| OwnedAccount::new(&mint.owner, &Pubkey::default(), 0, &[]));
        let global_owned = std::array::from_fn::<_, 2, _>(|index| {
            snapshot.globals[index].as_ref().map(|global| {
                OwnedAccount::new(
                    &get_global_address(&mint_keys[index]).0,
                    &global.owner,
                    global.lamports,
                    &global.data,
                )
            })
        });
        // SAFETY: every owned buffer above outlives all views, loaders, Core
        // calls and borrows below. No view escapes this method. Core's impact
        // methods do not perform CPI; they only inspect these private copies.
        let mint_views = mint_owned.each_ref().map(|owned| unsafe { owned.view() });
        let program_views = program_owned
            .each_ref()
            .map(|owned| unsafe { owned.view() });
        let global_views = global_owned
            .each_ref()
            .map(|owned| owned.as_ref().map(|owned| unsafe { owned.view() }));
        let load = |index: usize| -> Result<Option<GlobalTradeAccounts<'_>>> {
            let Some(view) = global_views[index].as_ref() else {
                return Ok(None);
            };
            Ok(Some(GlobalTradeAccounts {
                mint_opt: Some(
                    MintAccountInfo::new(&mint_views[index])
                        .map_err(|error| anyhow::anyhow!("mint loader: {error}"))?,
                ),
                global: ManifestAccountInfo::new(view)
                    .map_err(|error| anyhow::anyhow!("Global loader: {error}"))?,
                token_program_opt: Some(
                    TokenProgram::new(&program_views[index])
                        .map_err(|error| anyhow::anyhow!("token program: {error}"))?,
                ),
                global_vault_opt: None,
                market_vault_opt: None,
                system_program: None,
                gas_payer_opt: None,
                gas_receiver_opt: None,
                market: snapshot.key,
                num_deferred_gas_refunds: Cell::new(0),
            }))
        };
        let globals = [load(0)?, load(1)?];
        match direction {
            SwapDirection::BaseToQuote => snapshot
                .market
                .impact_quote_atoms_with_slot(false, BaseAtoms::new(amount_in), &globals, slot)
                .map(|amount| amount.as_u64()),
            SwapDirection::QuoteToBase => snapshot
                .market
                .impact_base_atoms_with_slot(true, QuoteAtoms::new(amount_in), &globals, slot)
                .map(|amount| amount.as_u64()),
        }
        .map_err(|error| anyhow::anyhow!("Core impact quote failed: {error}"))
    }
}
