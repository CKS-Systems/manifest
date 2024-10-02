use bytemuck::{Pod, Zeroable};
use hypertree::{
    get_helper, get_mut_helper, trace, DataIndex, FreeList, Get, HyperTreeReadOperations,
    HyperTreeValueIteratorTrait, HyperTreeWriteOperations, PodBool, RBNode, RedBlackTree,
    RedBlackTreeReadOnly, NIL,
};
use solana_program::{entrypoint::ProgramResult, program_error::ProgramError, pubkey::Pubkey};
use static_assertions::const_assert_eq;
use std::mem::size_of;

use crate::{
    logs::{emit_stack, FillLog},
    program::{batch_update::MarketDataTreeNodeType, ManifestError},
    quantities::{BaseAtoms, GlobalAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    require,
    state::{
        utils::{assert_can_take, remove_from_global, try_to_move_global_tokens},
        OrderType,
    },
    validation::{
        get_vault_address, loaders::GlobalTradeAccounts, ManifestAccount, MintAccountInfo,
    },
};

use super::{
    claimed_seat::ClaimedSeat,
    constants::{MARKET_BLOCK_SIZE, MARKET_FIXED_SIZE},
    order_type_can_rest,
    utils::{
        assert_already_has_seat, assert_not_already_expired, can_back_order, get_now_slot,
        try_to_add_to_global,
    },
    DerefOrBorrow, DerefOrBorrowMut, DynamicAccount, RestingOrder, MARKET_FIXED_DISCRIMINANT,
    MARKET_FREE_LIST_BLOCK_SIZE,
};

pub struct AddOrderToMarketArgs<'a, 'info> {
    pub market: Pubkey,
    pub trader_index: DataIndex,
    pub num_base_atoms: BaseAtoms,
    pub price: QuoteAtomsPerBaseAtom,
    pub is_bid: bool,
    pub last_valid_slot: u32,
    pub order_type: OrderType,
    pub global_trade_accounts_opts: &'a [Option<GlobalTradeAccounts<'a, 'info>>; 2],
    pub current_slot: Option<u32>,
}

pub struct AddOrderToMarketResult {
    pub order_sequence_number: u64,
    pub order_index: DataIndex,
    pub base_atoms_traded: BaseAtoms,
    pub quote_atoms_traded: QuoteAtoms,
}

#[repr(C, packed)]
#[derive(Default, Copy, Clone, Pod, Zeroable)]
struct MarketUnusedFreeListPadding {
    _padding: [u64; 9],
    _padding2: [u8; 4],
}
// 4 bytes are for the free list, rest is payload.
const_assert_eq!(
    size_of::<MarketUnusedFreeListPadding>(),
    MARKET_FREE_LIST_BLOCK_SIZE
);
// Does not need to align to word boundaries because does not deserialize.

#[repr(C)]
#[derive(Default, Copy, Clone, Zeroable, Pod)]
pub struct MarketFixed {
    /// Discriminant for identifying this type of account.
    pub discriminant: u64,

    /// Version
    version: u8,
    base_mint_decimals: u8,
    quote_mint_decimals: u8,
    base_vault_bump: u8,
    quote_vault_bump: u8,
    _padding1: [u8; 3],

    /// Base mint
    base_mint: Pubkey,
    /// Quote mint
    quote_mint: Pubkey,

    /// Base vault
    base_vault: Pubkey,
    /// Quote vault
    quote_vault: Pubkey,

    /// The sequence number of the next order.
    order_sequence_number: u64,

    /// Num bytes allocated as RestingOrder or ClaimedSeat or FreeList. Does not
    /// include the fixed bytes.
    num_bytes_allocated: u32,

    /// Red-black tree root representing the bids in the order book.
    bids_root_index: DataIndex,
    bids_best_index: DataIndex,

    /// Red-black tree root representing the asks in the order book.
    asks_root_index: DataIndex,
    asks_best_index: DataIndex,

    /// Red-black tree root representing the seats
    claimed_seats_root_index: DataIndex,

    /// LinkedList representing all free blocks that could be used for ClaimedSeats or RestingOrders
    free_list_head_index: DataIndex,

    _padding2: [u32; 1],

    /// Quote volume traded over lifetime, can overflow. This is for
    /// informational and monitoring purposes only. This is not guaranteed to
    /// be maintained. It does not secure any value in manifest.
    /// Use at your own risk.
    quote_volume: QuoteAtoms,

    // Unused padding. Saved in case a later version wants to be backwards
    // compatible. Also, it is nice to have the fixed size be a round number,
    // 256 bytes.
    _padding3: [u64; 8],
}
const_assert_eq!(
    size_of::<MarketFixed>(),
    8 +   // discriminant
    1 +   // version
    1 +   // base_mint_decimals
    1 +   // quote_mint_decimals
    1 +   // base_vault_bump
    1 +   // quote_vault_bump
    3 +   // padding
    32 +  // base_mint
    32 +  // quote_mint
    32 +  // base_vault
    32 +  // quote_vault
    8 +   // order_sequence_number
    4 +   // num_bytes_allocated
    4 +   // bids_root_index
    4 +   // bids_best_index
    4 +   // asks_root_index
    4 +   // asks_best_index
    4 +   // claimed_seats_root_index
    4 +   // claimed_seats_best_index
    4 +   // free_list_head_index
    8 +   // padding2
    64 // padding4
);
const_assert_eq!(size_of::<MarketFixed>(), MARKET_FIXED_SIZE);
const_assert_eq!(size_of::<MarketFixed>() % 8, 0);
impl Get for MarketFixed {}

impl MarketFixed {
    pub fn new_empty(
        base_mint: &MintAccountInfo,
        quote_mint: &MintAccountInfo,
        market_key: &Pubkey,
    ) -> Self {
        let (base_vault, base_vault_bump) = get_vault_address(market_key, base_mint.info.key);
        let (quote_vault, quote_vault_bump) = get_vault_address(market_key, quote_mint.info.key);
        MarketFixed {
            discriminant: MARKET_FIXED_DISCRIMINANT,
            version: 0,
            base_mint_decimals: base_mint.mint.decimals,
            quote_mint_decimals: quote_mint.mint.decimals,
            base_vault_bump,
            quote_vault_bump,
            _padding1: [0; 3],
            base_mint: *base_mint.info.key,
            quote_mint: *quote_mint.info.key,
            base_vault,
            quote_vault,
            order_sequence_number: 0,
            num_bytes_allocated: 0,
            bids_root_index: NIL,
            bids_best_index: NIL,
            asks_root_index: NIL,
            asks_best_index: NIL,
            claimed_seats_root_index: NIL,
            free_list_head_index: NIL,
            _padding2: [0; 1],
            quote_volume: QuoteAtoms::ZERO,
            _padding3: [0; 8],
        }
    }

    pub fn get_base_mint(&self) -> &Pubkey {
        &self.base_mint
    }
    pub fn get_quote_mint(&self) -> &Pubkey {
        &self.quote_mint
    }
    pub fn get_base_vault(&self) -> &Pubkey {
        &self.base_vault
    }
    pub fn get_quote_vault(&self) -> &Pubkey {
        &self.quote_vault
    }
    pub fn get_base_mint_decimals(&self) -> u8 {
        self.base_mint_decimals
    }
    pub fn get_quote_mint_decimals(&self) -> u8 {
        self.quote_mint_decimals
    }
    pub fn get_base_vault_bump(&self) -> u8 {
        self.base_vault_bump
    }
    pub fn get_quote_vault_bump(&self) -> u8 {
        self.quote_vault_bump
    }
    pub fn get_quote_volume(&self) -> QuoteAtoms {
        self.quote_volume
    }

    // Used only in this file to construct iterator
    pub(crate) fn get_bids_root_index(&self) -> DataIndex {
        self.bids_root_index
    }
    pub(crate) fn get_asks_root_index(&self) -> DataIndex {
        self.asks_root_index
    }
    pub(crate) fn get_bids_best_index(&self) -> DataIndex {
        self.bids_best_index
    }
    pub(crate) fn get_asks_best_index(&self) -> DataIndex {
        self.asks_best_index
    }

    // Used in benchmark
    pub fn has_free_block(&self) -> bool {
        self.free_list_head_index != NIL
    }
}

impl ManifestAccount for MarketFixed {
    fn verify_discriminant(&self) -> ProgramResult {
        require!(
            self.discriminant == MARKET_FIXED_DISCRIMINANT,
            ProgramError::InvalidAccountData,
            "Invalid market discriminant actual: {} expected: {}",
            self.discriminant,
            MARKET_FIXED_DISCRIMINANT
        )?;
        Ok(())
    }
}

/// Fully owned Market, used in clients that can copy.
pub type MarketValue = DynamicAccount<MarketFixed, Vec<u8>>;
/// Full market reference type.
pub type MarketRef<'a> = DynamicAccount<&'a MarketFixed, &'a [u8]>;
/// Full market reference type.
pub type MarketRefMut<'a> = DynamicAccount<&'a mut MarketFixed, &'a mut [u8]>;

pub type ClaimedSeatTree<'a> = RedBlackTree<'a, ClaimedSeat>;
pub type ClaimedSeatTreeReadOnly<'a> = RedBlackTreeReadOnly<'a, ClaimedSeat>;
pub type Bookside<'a> = RedBlackTree<'a, RestingOrder>;
pub type BooksideReadOnly<'a> = RedBlackTreeReadOnly<'a, RestingOrder>;

// This generic impl covers MarketRef, MarketRefMut and other
// DynamicAccount variants that allow read access.
impl<Fixed: DerefOrBorrow<MarketFixed>, Dynamic: DerefOrBorrow<[u8]>>
    DynamicAccount<Fixed, Dynamic>
{
    fn borrow_market(&self) -> MarketRef {
        MarketRef {
            fixed: self.fixed.deref_or_borrow(),
            dynamic: self.dynamic.deref_or_borrow(),
        }
    }

    pub fn get_base_mint(&self) -> &Pubkey {
        let DynamicAccount { fixed, .. } = self.borrow_market();
        fixed.get_base_mint()
    }

    pub fn get_quote_mint(&self) -> &Pubkey {
        let DynamicAccount { fixed, .. } = self.borrow_market();
        fixed.get_quote_mint()
    }

    // TODO: adapt to new rounding
    pub fn impact_quote_atoms(
        &self,
        is_bid: bool,
        limit_base_atoms: BaseAtoms,
        _global_trade_accounts_opts: &[Option<GlobalTradeAccounts>; 2],
    ) -> Result<QuoteAtoms, ProgramError> {
        let now_slot: u32 = get_now_slot();

        let book = if is_bid {
            self.get_asks()
        } else {
            self.get_bids()
        };

        let mut total_quote_atoms_matched: QuoteAtoms = QuoteAtoms::ZERO;
        let mut remaining_base_atoms = limit_base_atoms;
        for (_, other_order) in book.iter::<RestingOrder>() {
            if other_order.is_expired(now_slot) {
                continue;
            }
            let matched_price = other_order.get_price();
            let matched_base_atoms = other_order.get_num_base_atoms().min(remaining_base_atoms);
            let matched_quote_atoms =
                matched_price.checked_quote_for_base(matched_base_atoms, is_bid)?;

            if other_order.get_order_type() == OrderType::Global {
                // TODO: Check if the order is backed
            }
            total_quote_atoms_matched =
                total_quote_atoms_matched.checked_add(matched_quote_atoms)?;
            if matched_base_atoms == remaining_base_atoms {
                break;
            }

            remaining_base_atoms = remaining_base_atoms.checked_sub(matched_base_atoms)?;

            if remaining_base_atoms == BaseAtoms::ZERO {
                break;
            }
        }

        return Ok(total_quote_atoms_matched);
    }

    /// How many base atoms you get when you trade in limit_quote_atoms.
    pub fn impact_base_atoms(
        &self,
        is_bid: bool,
        limit_quote_atoms: QuoteAtoms,
        global_trade_accounts_opts: &[Option<GlobalTradeAccounts>; 2],
    ) -> Result<BaseAtoms, ProgramError> {
        let now_slot: u32 = get_now_slot();

        let book: RedBlackTreeReadOnly<'_, RestingOrder> = if is_bid {
            self.get_asks()
        } else {
            self.get_bids()
        };

        let mut total_matched_base_atoms: BaseAtoms = BaseAtoms::ZERO;
        let mut remaining_quote_atoms: QuoteAtoms = limit_quote_atoms;

        for (_, other_order) in book.iter::<RestingOrder>() {
            if other_order.is_expired(now_slot) {
                continue;
            }

            let matched_price: QuoteAtomsPerBaseAtom = other_order.get_price();
            // base_atoms_limit is the number of base atoms that you get if you
            // were to trade all of the remaining quote atoms at the current
            // price. Rounding is done in the taker favor because at the limit,
            // it is a full match. So if you are checking against asks with 100
            // quote remaining against price 1.001, then the answer should be
            // 100, because the rounding is in favor of the taker. It takes 100
            // base atoms to exhaust 100 quote atoms at that price.
            let base_atoms_limit: BaseAtoms =
                matched_price.checked_base_for_quote(remaining_quote_atoms, !is_bid)?;
            // Either fill the entire resting order, or only the
            // base_atoms_limit, in which case, this is the last iteration.
            let matched_base_atoms: BaseAtoms =
                other_order.get_num_base_atoms().min(base_atoms_limit);
            let did_fully_match_resting_order: bool =
                base_atoms_limit >= other_order.get_num_base_atoms();

            // Number of quote atoms matched exactly. Always round in taker favor
            // here because we already know that taker did not finish on the last
            // order, so fully exhausted it and thus are rounding in taker
            // favor.
            let matched_quote_atoms: QuoteAtoms = matched_price.checked_quote_for_base(
                matched_base_atoms,
                is_bid != did_fully_match_resting_order,
            )?;

            // TODO: Clean this up into a separate function.
            if other_order.get_order_type() == OrderType::Global {
                // If global accounts are needed but not present, then this will
                // crash. This is an intentional product decision. Would be
                // valid to walk past, but we have chosen to give no fill rather
                // than worse price if the taker takes the shortcut of not
                // including global account.
                let global_trade_accounts_opt: &Option<GlobalTradeAccounts> = if is_bid {
                    &global_trade_accounts_opts[0]
                } else {
                    &global_trade_accounts_opts[1]
                };
                let has_enough_tokens: bool = can_back_order(
                    global_trade_accounts_opt,
                    self.get_trader_key_by_index(other_order.get_trader_index()),
                    GlobalAtoms::new(if is_bid {
                        matched_base_atoms.as_u64()
                    } else {
                        matched_quote_atoms.as_u64()
                    }),
                );
                if !has_enough_tokens {
                    continue;
                }
            }

            total_matched_base_atoms = total_matched_base_atoms.checked_add(matched_base_atoms)?;

            if matched_base_atoms == base_atoms_limit {
                break;
            }

            remaining_quote_atoms = remaining_quote_atoms.checked_sub(matched_quote_atoms)?;
            if remaining_quote_atoms == QuoteAtoms::ZERO {
                break;
            }
        }

        // Note that when there are not enough orders on the market to use up or
        // to receive the desired number of quote atoms, this returns just the
        // full amount on the bookside without differentiating that return.

        return Ok(total_matched_base_atoms);
    }

    pub fn get_order_by_index(&self, index: DataIndex) -> &RestingOrder {
        let DynamicAccount { dynamic, .. } = self.borrow_market();
        &get_helper::<RBNode<RestingOrder>>(dynamic, index).get_value()
    }

    pub fn get_trader_balance(&self, trader: &Pubkey) -> (BaseAtoms, QuoteAtoms) {
        let DynamicAccount { fixed, dynamic } = self.borrow_market();

        let claimed_seats_tree: ClaimedSeatTreeReadOnly =
            ClaimedSeatTreeReadOnly::new(dynamic, fixed.claimed_seats_root_index, NIL);
        let trader_index: DataIndex =
            claimed_seats_tree.lookup_index(&ClaimedSeat::new_empty(*trader));
        let claimed_seat: &ClaimedSeat =
            get_helper::<RBNode<ClaimedSeat>>(dynamic, trader_index).get_value();
        (
            claimed_seat.base_withdrawable_balance,
            claimed_seat.quote_withdrawable_balance,
        )
    }

    pub fn get_trader_key_by_index(&self, index: DataIndex) -> &Pubkey {
        let DynamicAccount { dynamic, .. } = self.borrow_market();

        &get_helper::<RBNode<ClaimedSeat>>(dynamic, index)
            .get_value()
            .trader
    }

    pub fn get_trader_voume(&self, trader: &Pubkey) -> QuoteAtoms {
        let DynamicAccount { fixed, dynamic } = self.borrow_market();

        let claimed_seats_tree: ClaimedSeatTreeReadOnly =
            ClaimedSeatTreeReadOnly::new(dynamic, fixed.claimed_seats_root_index, NIL);
        let trader_index: DataIndex =
            claimed_seats_tree.lookup_index(&ClaimedSeat::new_empty(*trader));
        let claimed_seat: &ClaimedSeat =
            get_helper::<RBNode<ClaimedSeat>>(dynamic, trader_index).get_value();

        claimed_seat.quote_volume
    }

    pub fn get_bids(&self) -> BooksideReadOnly {
        let DynamicAccount { dynamic, fixed } = self.borrow_market();
        BooksideReadOnly::new(
            dynamic,
            fixed.get_bids_root_index(),
            fixed.get_bids_best_index(),
        )
    }

    pub fn get_asks(&self) -> BooksideReadOnly {
        let DynamicAccount { dynamic, fixed } = self.borrow_market();
        BooksideReadOnly::new(
            dynamic,
            fixed.get_asks_root_index(),
            fixed.get_asks_best_index(),
        )
    }
}

// This generic impl covers MarketRef, MarketRefMut and other
// DynamicAccount variants that allow write access.
impl<Fixed: DerefOrBorrowMut<MarketFixed>, Dynamic: DerefOrBorrowMut<[u8]>>
    DynamicAccount<Fixed, Dynamic>
{
    fn borrow_mut(&mut self) -> MarketRefMut {
        MarketRefMut {
            fixed: self.fixed.deref_or_borrow_mut(),
            dynamic: self.dynamic.deref_or_borrow_mut(),
        }
    }

    pub fn market_expand(&mut self) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut();
        let mut free_list: FreeList<MarketUnusedFreeListPadding> =
            FreeList::new(dynamic, fixed.free_list_head_index);

        free_list.add(fixed.num_bytes_allocated);
        fixed.num_bytes_allocated += MARKET_BLOCK_SIZE as u32;
        fixed.free_list_head_index = free_list.get_head();
        Ok(())
    }

    pub fn claim_seat(&mut self, trader: &Pubkey) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut();
        let free_address: DataIndex = get_free_address_on_market_fixed(fixed, dynamic);

        let mut claimed_seats_tree: ClaimedSeatTree =
            ClaimedSeatTree::new(dynamic, fixed.claimed_seats_root_index, NIL);

        let claimed_seat: ClaimedSeat = ClaimedSeat::new_empty(*trader);
        require!(
            claimed_seats_tree.lookup_index(&claimed_seat) == NIL,
            ManifestError::AlreadyClaimedSeat,
            "Already claimed seat",
        )?;

        claimed_seats_tree.insert(free_address, claimed_seat);
        fixed.claimed_seats_root_index = claimed_seats_tree.get_root_index();

        get_mut_helper::<RBNode<ClaimedSeat>>(dynamic, free_address)
            .set_payload_type(MarketDataTreeNodeType::ClaimedSeat as u8);
        Ok(())
    }

    // Uses mut instead of immutable because of trait issues.
    pub fn get_trader_index(&mut self, trader: &Pubkey) -> DataIndex {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut();

        let claimed_seats_tree: ClaimedSeatTreeReadOnly =
            ClaimedSeatTreeReadOnly::new(dynamic, fixed.claimed_seats_root_index, NIL);
        let trader_index: DataIndex =
            claimed_seats_tree.lookup_index(&ClaimedSeat::new_empty(*trader));
        trader_index
    }

    pub fn release_seat(&mut self, trader: &Pubkey) -> ProgramResult {
        let trader_seat_index: DataIndex = self.get_trader_index(trader);
        let DynamicAccount { fixed, dynamic } = self.borrow_mut();

        let mut claimed_seats_tree: ClaimedSeatTree =
            ClaimedSeatTree::new(dynamic, fixed.claimed_seats_root_index, NIL);
        claimed_seats_tree.remove_by_index(trader_seat_index);
        fixed.claimed_seats_root_index = claimed_seats_tree.get_root_index();

        // Put back seat on free list.
        let mut free_list: FreeList<MarketUnusedFreeListPadding> =
            FreeList::new(dynamic, fixed.free_list_head_index);
        free_list.add(trader_seat_index);
        fixed.free_list_head_index = trader_seat_index;

        Ok(())
    }

    pub fn deposit(&mut self, trader: &Pubkey, amount_atoms: u64, is_base: bool) -> ProgramResult {
        let trader_index: DataIndex = self.get_trader_index(trader);
        require!(
            trader_index != NIL,
            ManifestError::InvalidDepositAccounts,
            "No seat initialized",
        )?;

        let DynamicAccount { dynamic, .. } = self.borrow_mut();
        update_balance(dynamic, trader_index, is_base, true, amount_atoms)?;
        Ok(())
    }

    pub fn withdraw(&mut self, trader: &Pubkey, amount_atoms: u64, is_base: bool) -> ProgramResult {
        let trader_index: DataIndex = self.get_trader_index(trader);

        let DynamicAccount { dynamic, .. } = self.borrow_mut();
        update_balance(dynamic, trader_index, is_base, false, amount_atoms)?;
        Ok(())
    }

    /// Place an order and update the market
    ///
    /// 1. Check the order against the opposite bookside
    /// 2. Rest any amount of the order leftover on the book
    pub fn place_order(
        &mut self,
        args: AddOrderToMarketArgs,
    ) -> Result<AddOrderToMarketResult, ProgramError> {
        let AddOrderToMarketArgs {
            market,
            trader_index,
            num_base_atoms,
            price,
            is_bid,
            last_valid_slot,
            order_type,
            global_trade_accounts_opts,
            current_slot,
        } = args;
        assert_already_has_seat(trader_index)?;
        let now_slot: u32 = current_slot.unwrap_or_else(|| get_now_slot());

        assert_not_already_expired(last_valid_slot, now_slot)?;

        let DynamicAccount { fixed, dynamic } = self.borrow_mut();

        let mut current_order_index: DataIndex = if is_bid {
            fixed.asks_best_index
        } else {
            fixed.bids_best_index
        };

        let mut total_base_atoms_traded: BaseAtoms = BaseAtoms::ZERO;
        let mut total_quote_atoms_traded: QuoteAtoms = QuoteAtoms::ZERO;

        let mut remaining_base_atoms: BaseAtoms = num_base_atoms;
        while remaining_base_atoms > BaseAtoms::ZERO && current_order_index != NIL {
            let other_order: &RestingOrder =
                get_helper::<RBNode<RestingOrder>>(dynamic, current_order_index).get_value();

            // Remove the resting order if expired.
            if other_order.is_expired(now_slot) {
                let next_order_index: DataIndex =
                    get_next_candidate_match_index(fixed, dynamic, current_order_index, is_bid);
                remove_and_update_balances(
                    fixed,
                    dynamic,
                    current_order_index,
                    global_trade_accounts_opts,
                )?;
                current_order_index = next_order_index;
                continue;
            }

            // Stop trying to match if price no longer satisfies limit.
            if (is_bid && other_order.get_price() > price)
                || (!is_bid && other_order.get_price() < price)
            {
                break;
            }

            // Got a match. First make sure we are allowed to match. We check
            // inside the matching rather than skipping the matching altogether
            // because post only orders should fail, not produce a crossed book.
            trace!(
                "match {} {order_type:?} {price:?} with {other_order:?}",
                if is_bid { "bid" } else { "ask" }
            );
            assert_can_take(order_type)?;

            let maker_sequence_number = other_order.get_sequence_number();
            let other_trader_index: DataIndex = other_order.get_trader_index();
            let did_fully_match_resting_order: bool =
                remaining_base_atoms >= other_order.get_num_base_atoms();
            let base_atoms_traded: BaseAtoms = if did_fully_match_resting_order {
                other_order.get_num_base_atoms()
            } else {
                remaining_base_atoms
            };

            let matched_price: QuoteAtomsPerBaseAtom = other_order.get_price();

            // on full fill: round in favor of the taker
            // on partial fill: round in favor of the maker
            let quote_atoms_traded: QuoteAtoms = matched_price.checked_quote_for_base(
                base_atoms_traded,
                is_bid != did_fully_match_resting_order,
            )?;

            // If it is a global order, just in time bring the funds over, or
            // remove from the tree and continue on to the next order.
            let maker: Pubkey =
                get_helper::<RBNode<ClaimedSeat>>(dynamic, other_order.get_trader_index())
                    .get_value()
                    .trader;
            let taker: Pubkey = get_helper::<RBNode<ClaimedSeat>>(dynamic, trader_index)
                .get_value()
                .trader;
            let is_global: bool = other_order.is_global();

            if is_global {
                let global_trade_accounts_opt: &Option<GlobalTradeAccounts> = if is_bid {
                    &global_trade_accounts_opts[0]
                } else {
                    &global_trade_accounts_opts[1]
                };
                let has_enough_tokens: bool = try_to_move_global_tokens(
                    global_trade_accounts_opt,
                    &maker,
                    GlobalAtoms::new(if is_bid {
                        quote_atoms_traded.as_u64()
                    } else {
                        base_atoms_traded.as_u64()
                    }),
                )?;
                if !has_enough_tokens {
                    let next_order_index: DataIndex =
                        get_next_candidate_match_index(fixed, dynamic, current_order_index, is_bid);
                    remove_and_update_balances(
                        fixed,
                        dynamic,
                        current_order_index,
                        global_trade_accounts_opts,
                    )?;
                    current_order_index = next_order_index;
                    continue;
                }
            }

            total_base_atoms_traded = total_base_atoms_traded.checked_add(base_atoms_traded)?;
            total_quote_atoms_traded = total_quote_atoms_traded.checked_add(quote_atoms_traded)?;

            // Possibly increase bonus atom maker gets from the rounding the
            // quote in their favor. They will get one less than expected when
            // cancelling because of rounding, this counters that. This ensures
            // that the amount of quote that the maker has credit for when they
            // cancel/expire is always the maximum amount that could have been
            // used in matching that order.
            // Example:
            // Maker deposits 11            | Balance: 0 base 11 quote | Orders: []
            // Maker bid for 10@1.15        | Balance: 0 base 0 quote  | Orders: [bid 10@1.15]
            // Swap    5 base <--> 5 quote  | Balance: 5 base 0 quote  | Orders: [bid 5@1.15]
            //     <this code block>        | Balance: 5 base 1 quote  | Orders: [bid 5@1.15]
            // Maker cancel                 | Balance: 5 base 6 quote  | Orders: []
            //
            // The swapper deposited 5 base and withdrew 5 quote. The maker deposited 11 quote.
            // If we didnt do this adjustment, there would be an unaccounted for
            // quote atom.
            // Note that we do not have to do this on the other direction
            // because the amount of atoms that a maker needs to support an ask
            // is exact. The rounding is always on quote.
            if !is_bid {
                // These are only used when is_bid, included up here for borrow checker reasons.
                let other_order: &RestingOrder =
                    get_helper::<RBNode<RestingOrder>>(dynamic, current_order_index).get_value();
                let previous_maker_quote_atoms_allocated: QuoteAtoms =
                    matched_price.checked_quote_for_base(other_order.get_num_base_atoms(), true)?;
                let new_maker_quote_atoms_allocated: QuoteAtoms = matched_price
                    .checked_quote_for_base(
                        other_order
                            .get_num_base_atoms()
                            .checked_sub(base_atoms_traded)?,
                        true,
                    )?;
                update_balance(
                    dynamic,
                    other_trader_index,
                    is_bid,
                    true,
                    (previous_maker_quote_atoms_allocated
                        .checked_sub(new_maker_quote_atoms_allocated)?
                        .checked_sub(quote_atoms_traded)?)
                    .as_u64(),
                )?;
            }

            // Increase maker from the matched amount in the trade.
            update_balance(
                dynamic,
                other_trader_index,
                !is_bid,
                true,
                if is_bid {
                    quote_atoms_traded.into()
                } else {
                    base_atoms_traded.into()
                },
            )?;
            // Decrease taker
            update_balance(
                dynamic,
                trader_index,
                !is_bid,
                false,
                if is_bid {
                    quote_atoms_traded.into()
                } else {
                    base_atoms_traded.into()
                },
            )?;
            // Increase taker
            update_balance(
                dynamic,
                trader_index,
                is_bid,
                true,
                if is_bid {
                    base_atoms_traded.into()
                } else {
                    quote_atoms_traded.into()
                },
            )?;

            // record maker & taker volume
            record_volume_by_trader_index(dynamic, other_trader_index, quote_atoms_traded);
            record_volume_by_trader_index(dynamic, trader_index, quote_atoms_traded);

            emit_stack(FillLog {
                market,
                maker,
                taker,
                base_atoms: base_atoms_traded,
                quote_atoms: quote_atoms_traded,
                price: matched_price,
                maker_sequence_number,
                taker_sequence_number: fixed.order_sequence_number,
                taker_is_buy: PodBool::from(is_bid),
                is_maker_global: PodBool::from(is_global),
                _padding: [0; 14],
            })?;

            if did_fully_match_resting_order {
                // Get paid for removing a global order.
                if get_helper::<RBNode<RestingOrder>>(dynamic, current_order_index)
                    .get_value()
                    .get_order_type()
                    == OrderType::Global
                {
                    let global_trade_accounts_opt: &Option<GlobalTradeAccounts> = if is_bid {
                        &global_trade_accounts_opts[0]
                    } else {
                        &global_trade_accounts_opts[1]
                    };
                    remove_from_global(&global_trade_accounts_opt, &maker)?;
                }

                let next_order_index: DataIndex =
                    get_next_candidate_match_index(fixed, dynamic, current_order_index, is_bid);
                remove_order_from_tree_and_free(fixed, dynamic, current_order_index, !is_bid)?;
                remaining_base_atoms = remaining_base_atoms.checked_sub(base_atoms_traded)?;
                current_order_index = next_order_index;
            } else {
                let other_order: &mut RestingOrder =
                    get_mut_helper::<RBNode<RestingOrder>>(dynamic, current_order_index)
                        .get_mut_value();
                other_order.reduce(base_atoms_traded)?;
                remaining_base_atoms = BaseAtoms::ZERO;
                break;
            }
        }

        // Record volume on market
        fixed.quote_volume = fixed.quote_volume.wrapping_add(total_quote_atoms_traded);

        // Bump the order sequence number even for orders which do not end up
        // resting.
        let order_sequence_number: u64 = fixed.order_sequence_number;
        fixed.order_sequence_number = order_sequence_number.wrapping_add(1);

        // If there is nothing left to rest, then return before resting.
        if !order_type_can_rest(order_type)
            || remaining_base_atoms == BaseAtoms::ZERO
            || price == QuoteAtomsPerBaseAtom::ZERO
        {
            return Ok(AddOrderToMarketResult {
                order_sequence_number,
                order_index: NIL,
                base_atoms_traded: total_base_atoms_traded,
                quote_atoms_traded: total_quote_atoms_traded,
            });
        }

        self.rest_remaining(
            args,
            remaining_base_atoms,
            order_sequence_number,
            total_base_atoms_traded,
            total_quote_atoms_traded,
        )
    }

    /// Rest the remaining order onto the market in a RestingOrder.
    fn rest_remaining(
        &mut self,
        args: AddOrderToMarketArgs,
        remaining_base_atoms: BaseAtoms,
        order_sequence_number: u64,
        total_base_atoms_traded: BaseAtoms,
        total_quote_atoms_traded: QuoteAtoms,
    ) -> Result<AddOrderToMarketResult, ProgramError> {
        let AddOrderToMarketArgs {
            trader_index,
            price,
            is_bid,
            last_valid_slot,
            order_type,
            global_trade_accounts_opts,
            ..
        } = args;
        let DynamicAccount { fixed, dynamic } = self.borrow_mut();

        // Put the remaining in an order on the other bookside.
        let free_address: DataIndex = get_free_address_on_market_fixed(fixed, dynamic);

        let resting_order: RestingOrder = RestingOrder::new(
            trader_index,
            remaining_base_atoms,
            price,
            order_sequence_number,
            last_valid_slot,
            is_bid,
            order_type,
        )?;

        if resting_order.is_global() {
            let global_trade_accounts_opt: &Option<GlobalTradeAccounts> = if is_bid {
                &global_trade_accounts_opts[1]
            } else {
                &global_trade_accounts_opts[0]
            };
            require!(
                global_trade_accounts_opt.is_some(),
                ManifestError::MissingGlobal,
                "Missing global accounts when adding a global",
            )?;
            try_to_add_to_global(&global_trade_accounts_opt.as_ref().unwrap(), &resting_order)?;
        } else {
            // Place the remaining.
            // Rounds up quote atoms so price can be rounded in favor of taker
            update_balance(
                dynamic,
                trader_index,
                !is_bid,
                false,
                if is_bid {
                    (remaining_base_atoms.checked_mul(price, true))
                        .unwrap()
                        .into()
                } else {
                    remaining_base_atoms.into()
                },
            )?;
        }
        insert_order_into_tree(is_bid, fixed, dynamic, free_address, &resting_order);

        get_mut_helper::<RBNode<RestingOrder>>(dynamic, free_address)
            .set_payload_type(MarketDataTreeNodeType::RestingOrder as u8);

        Ok(AddOrderToMarketResult {
            order_sequence_number,
            order_index: free_address,
            base_atoms_traded: total_base_atoms_traded,
            quote_atoms_traded: total_quote_atoms_traded,
        })
    }

    // Does a linear scan over the orderbook to find the index to cancel.
    pub fn cancel_order(
        &mut self,
        trader_index: DataIndex,
        order_sequence_number: u64,
        global_trade_accounts_opts: &[Option<GlobalTradeAccounts>; 2],
    ) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut();

        let mut index_to_remove: DataIndex = NIL;
        for is_searching_bids in [false, true] {
            let tree: BooksideReadOnly = if is_searching_bids {
                BooksideReadOnly::new(dynamic, fixed.bids_root_index, fixed.bids_best_index)
            } else {
                BooksideReadOnly::new(dynamic, fixed.asks_root_index, fixed.asks_best_index)
            };
            for (index, resting_order) in tree.iter::<RestingOrder>() {
                if resting_order.get_sequence_number() == order_sequence_number {
                    require!(
                        resting_order.get_trader_index() == trader_index,
                        ManifestError::InvalidCancel,
                        "Cannot cancel for another trader",
                    )?;
                    require!(
                        index_to_remove == NIL,
                        ManifestError::InvalidCancel,
                        "Book is broken, matched multiple orders",
                    )?;
                    index_to_remove = index;
                }
            }
            if index_to_remove != NIL {
                // Cancel order by index will update balances.
                self.cancel_order_by_index(
                    trader_index,
                    index_to_remove,
                    global_trade_accounts_opts,
                )?;
                return Ok(());
            }
        }

        // Do not fail silently.
        Err(ManifestError::InvalidCancel.into())
    }

    pub fn cancel_order_by_index(
        &mut self,
        trader_index: DataIndex,
        order_index: DataIndex,
        global_trade_accounts_opts: &[Option<GlobalTradeAccounts>; 2],
    ) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut();

        let resting_order: &RestingOrder =
            get_helper::<RBNode<RestingOrder>>(dynamic, order_index).get_value();
        let is_bid: bool = resting_order.get_is_bid();
        let amount_atoms: u64 = if is_bid {
            (resting_order
                .get_price()
                .checked_quote_for_base(resting_order.get_num_base_atoms(), false)
                .unwrap())
            .into()
        } else {
            resting_order.get_num_base_atoms().into()
        };

        // Update the accounting for the order that was just canceled.
        if resting_order.is_global() {
            let global_trade_accounts_opt: &Option<GlobalTradeAccounts> = if is_bid {
                &global_trade_accounts_opts[1]
            } else {
                &global_trade_accounts_opts[0]
            };
            let trader: &Pubkey = &get_helper::<RBNode<ClaimedSeat>>(dynamic, trader_index)
                .get_value()
                .trader;
            remove_from_global(&global_trade_accounts_opt, trader)?
        } else {
            update_balance(dynamic, trader_index, !is_bid, true, amount_atoms)?;
        }
        remove_order_from_tree_and_free(fixed, dynamic, order_index, is_bid)?;

        Ok(())
    }
}

fn remove_order_from_tree(
    fixed: &mut MarketFixed,
    dynamic: &mut [u8],
    order_index: DataIndex,
    is_bids: bool,
) -> ProgramResult {
    let mut tree: Bookside = if is_bids {
        Bookside::new(dynamic, fixed.bids_root_index, fixed.bids_best_index)
    } else {
        Bookside::new(dynamic, fixed.asks_root_index, fixed.asks_best_index)
    };
    tree.remove_by_index(order_index);

    // Possibly changes the root and/or best.
    if is_bids {
        trace!(
            "remove order bid root:{}->{} max:{}->{}",
            fixed.bids_root_index,
            tree.get_root_index(),
            fixed.bids_best_index,
            tree.get_max_index()
        );
        fixed.bids_root_index = tree.get_root_index();
        fixed.bids_best_index = tree.get_max_index();
    } else {
        trace!(
            "remove order ask root:{}->{} max:{}->{}",
            fixed.asks_root_index,
            tree.get_root_index(),
            fixed.asks_best_index,
            tree.get_max_index()
        );
        fixed.asks_root_index = tree.get_root_index();
        fixed.asks_best_index = tree.get_max_index();
    }
    Ok(())
}

// Remove order from the tree, free the block.
fn remove_order_from_tree_and_free(
    fixed: &mut MarketFixed,
    dynamic: &mut [u8],
    order_index: DataIndex,
    is_bids: bool,
) -> ProgramResult {
    remove_order_from_tree(fixed, dynamic, order_index, is_bids)?;
    let mut free_list: FreeList<MarketUnusedFreeListPadding> =
        FreeList::new(dynamic, fixed.free_list_head_index);
    free_list.add(order_index);
    fixed.free_list_head_index = order_index;
    Ok(())
}

fn update_balance(
    dynamic: &mut [u8],
    trader_index: DataIndex,
    is_base: bool,
    is_increase: bool,
    amount_atoms: u64,
) -> ProgramResult {
    let claimed_seat: &mut ClaimedSeat =
        get_mut_helper::<RBNode<ClaimedSeat>>(dynamic, trader_index).get_mut_value();

    trace!("update_balance_by_trader_index idx:{trader_index} base:{is_base} inc:{is_increase} amount:{amount_atoms}");
    if is_base {
        if is_increase {
            claimed_seat.base_withdrawable_balance = claimed_seat
                .base_withdrawable_balance
                .checked_add(BaseAtoms::new(amount_atoms))?;
        } else {
            require!(
                claimed_seat.base_withdrawable_balance >= BaseAtoms::new(amount_atoms),
                ProgramError::InsufficientFunds,
                "Not enough base atoms. Has {}, needs {}",
                claimed_seat.base_withdrawable_balance,
                amount_atoms
            )?;
            claimed_seat.base_withdrawable_balance = claimed_seat
                .base_withdrawable_balance
                .checked_sub(BaseAtoms::new(amount_atoms))?;
        }
    } else if is_increase {
        claimed_seat.quote_withdrawable_balance = claimed_seat
            .quote_withdrawable_balance
            .checked_add(QuoteAtoms::new(amount_atoms))?;
    } else {
        require!(
            claimed_seat.quote_withdrawable_balance >= QuoteAtoms::new(amount_atoms),
            ProgramError::InsufficientFunds,
            "Not enough quote atoms. Has {}, needs {}",
            claimed_seat.quote_withdrawable_balance,
            amount_atoms
        )?;
        claimed_seat.quote_withdrawable_balance = claimed_seat
            .quote_withdrawable_balance
            .checked_sub(QuoteAtoms::new(amount_atoms))?;
    }
    Ok(())
}

fn record_volume_by_trader_index(
    dynamic: &mut [u8],
    trader_index: DataIndex,
    amount_atoms: QuoteAtoms,
) {
    let claimed_seat: &mut ClaimedSeat =
        get_mut_helper::<RBNode<ClaimedSeat>>(dynamic, trader_index).get_mut_value();
    claimed_seat.quote_volume = claimed_seat.quote_volume.wrapping_add(amount_atoms);
}

#[inline(always)]
fn insert_order_into_tree(
    is_bid: bool,
    fixed: &mut MarketFixed,
    dynamic: &mut [u8],
    free_address: DataIndex,
    resting_order: &RestingOrder,
) {
    let mut tree: Bookside = if is_bid {
        Bookside::new(dynamic, fixed.bids_root_index, fixed.bids_best_index)
    } else {
        Bookside::new(dynamic, fixed.asks_root_index, fixed.asks_best_index)
    };
    tree.insert(free_address, *resting_order);
    if is_bid {
        trace!(
            "insert order bid {resting_order:?} root:{}->{} max:{}->{}->{}",
            fixed.bids_root_index,
            tree.get_root_index(),
            fixed.bids_best_index,
            tree.get_max_index(),
            tree.get_next_lower_index::<RestingOrder>(tree.get_max_index()),
        );
        fixed.bids_root_index = tree.get_root_index();
        fixed.bids_best_index = tree.get_max_index();
    } else {
        trace!(
            "insert order ask {resting_order:?} root:{}->{} max:{}->{}->{}",
            fixed.asks_root_index,
            tree.get_root_index(),
            fixed.asks_best_index,
            tree.get_max_index(),
            tree.get_next_lower_index::<RestingOrder>(tree.get_max_index()),
        );
        fixed.asks_root_index = tree.get_root_index();
        fixed.asks_best_index = tree.get_max_index();
    }
}

fn get_next_candidate_match_index(
    fixed: &MarketFixed,
    dynamic: &[u8],
    current_order_index: DataIndex,
    is_bid: bool,
) -> DataIndex {
    if is_bid {
        let tree: BooksideReadOnly =
            BooksideReadOnly::new(dynamic, fixed.asks_root_index, fixed.asks_best_index);
        let next_order_index: DataIndex =
            tree.get_next_lower_index::<RestingOrder>(current_order_index);
        next_order_index
    } else {
        let tree: BooksideReadOnly =
            BooksideReadOnly::new(dynamic, fixed.bids_root_index, fixed.bids_best_index);
        let next_order_index: DataIndex =
            tree.get_next_lower_index::<RestingOrder>(current_order_index);
        next_order_index
    }
}

fn get_free_address_on_market_fixed(fixed: &mut MarketFixed, dynamic: &mut [u8]) -> DataIndex {
    let mut free_list: FreeList<MarketUnusedFreeListPadding> =
        FreeList::new(dynamic, fixed.free_list_head_index);
    let free_address: DataIndex = free_list.remove();
    fixed.free_list_head_index = free_list.get_head();
    free_address
}

fn remove_and_update_balances(
    fixed: &mut MarketFixed,
    dynamic: &mut [u8],
    order_to_remove_index: DataIndex,
    global_trade_accounts_opts: &[Option<GlobalTradeAccounts>; 2],
) -> ProgramResult {
    let other_order: &RestingOrder =
        get_helper::<RBNode<RestingOrder>>(dynamic, order_to_remove_index).get_value();
    let other_is_bid: bool = other_order.get_is_bid();

    // Global order balances are accounted for on the global accounts, not on the market.
    if other_order.is_global() {
        let global_trade_accounts_opt: &Option<GlobalTradeAccounts> = if other_is_bid {
            &global_trade_accounts_opts[1]
        } else {
            &global_trade_accounts_opts[0]
        };
        let maker: &Pubkey =
            &get_helper::<RBNode<ClaimedSeat>>(dynamic, other_order.get_trader_index())
                .get_value()
                .trader;
        remove_from_global(&global_trade_accounts_opt, maker)?;
    } else {
        // Return the exact number of atoms if the resting order is an
        // ask. If the resting order is bid, multiply by price and round
        // in favor of the taker which here means up. The maker places
        // the minimum number of atoms required.
        let amount_atoms_to_return: u64 = if other_is_bid {
            other_order
                .get_price()
                .checked_quote_for_base(other_order.get_num_base_atoms(), true)?
                .as_u64()
        } else {
            other_order.get_num_base_atoms().as_u64()
        };
        update_balance(
            dynamic,
            other_order.get_trader_index(),
            !other_is_bid,
            true,
            amount_atoms_to_return,
        )?;
    }
    remove_order_from_tree_and_free(fixed, dynamic, order_to_remove_index, other_is_bid)?;
    Ok(())
}
