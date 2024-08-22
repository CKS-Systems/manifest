/// The global order state stores information about all global orders for a given token.
///
/// The reason for global orders to be sharded by token is that it will make it
/// more effective for landing transactions. Rather than requiring a write lock
/// for state that covers all markets, you just need to write lock state that
/// covers all orders involving a given token.
///
// It is a tree of trees.
// Top level is by trader. Second level is markets.
use std::{cmp::Ordering, mem::size_of};

use bytemuck::{Pod, Zeroable};
use hypertree::{
    get_helper, get_mut_helper, DataIndex, FreeList, RBNode, RedBlackTree, RedBlackTreeReadOnly,
    TreeReadOperations, NIL,
};
use solana_program::{entrypoint::ProgramResult, program_error::ProgramError, pubkey::Pubkey};
use static_assertions::const_assert_eq;

use crate::{
    program::{assert_with_msg, ManifestError},
    quantities::{GlobalAtoms, WrapperU64},
    validation::{get_global_vault_address, ManifestAccount},
};

use super::{
    DerefOrBorrow, DerefOrBorrowMut, DynamicAccount, RestingOrder, BLOCK_SIZE,
    FREE_LIST_BLOCK_SIZE, GLOBAL_FIXED_DISCRIMINANT, GLOBAL_FIXED_SIZE,
    GLOBAL_TRADER_MARKET_INFO_SIZE, GLOBAL_TRADER_SIZE,
};

#[repr(C)]
#[derive(Default, Copy, Clone, Zeroable, Pod)]
pub struct GlobalFixed {
    /// Discriminant for identifying this type of account.
    pub discriminant: u64,

    /// Mint for this global
    mint: Pubkey,

    /// Vault address
    vault: Pubkey,

    /// Red-black tree root representing the global orders for the bank.
    global_traders_root_index: DataIndex,

    /// LinkedList representing all free blocks that could be used for ClaimedSeats or RestingOrders
    free_list_head_index: DataIndex,

    /// Number of bytes allocated so far.
    num_bytes_allocated: DataIndex,

    vault_bump: u8,

    _unused_padding: [u8; 3],
}
const_assert_eq!(
    size_of::<GlobalFixed>(),
    8  +  // discriminant
    32 +  // mint
    32 +  // vault
    4 +   // global_seats_root_index
    4 +   // free_list_head_index
    4 +   // num_bytes_allocated
    1 +   // vault_bump
    3 // unused_padding
);
const_assert_eq!(size_of::<GlobalFixed>(), GLOBAL_FIXED_SIZE);
const_assert_eq!(size_of::<GlobalFixed>() % 8, 0);

#[repr(C, packed)]
#[derive(Default, Copy, Clone, Pod, Zeroable)]
struct GlobalUnusedFreeListPadding {
    _padding: [u64; 9],
    _padding2: [u8; 4],
}
// 4 bytes are for the free list, rest is payload.
const_assert_eq!(
    size_of::<GlobalUnusedFreeListPadding>(),
    FREE_LIST_BLOCK_SIZE
);
// Does not need to align to word boundaries because does not deserialize.

#[repr(C)]
#[derive(Default, Copy, Clone, Zeroable, Pod)]
pub struct GlobalTrader {
    /// Trader who controls this global trader.
    trader: Pubkey,

    /// Token balance in the global account for this trader. The tokens received
    /// in trades stay in the market.
    balance_atoms: GlobalAtoms,

    /// Red-black tree for global trades for this trader.
    global_trade_infos_root_index: DataIndex,

    /// unused padding
    _padding: [u32; 5],
}
const_assert_eq!(size_of::<GlobalTraderMarketInfo>(), GLOBAL_TRADER_SIZE);
const_assert_eq!(size_of::<GlobalTraderMarketInfo>() % 8, 0);

impl Ord for GlobalTrader {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.trader).cmp(&(other.trader))
    }
}
impl PartialOrd for GlobalTrader {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for GlobalTrader {
    fn eq(&self, other: &Self) -> bool {
        (self.trader) == (other.trader)
    }
}
impl Eq for GlobalTrader {}
impl std::fmt::Display for GlobalTrader {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.trader)
    }
}

// Global trade info for a given trader and market.
#[repr(C)]
#[derive(Default, Copy, Clone, Zeroable, Pod)]
pub struct GlobalTraderMarketInfo {
    market: Pubkey,

    /// Number of atoms of the global token in all orders combined on this market.
    num_atoms: GlobalAtoms,

    _padding: [u8; 24],
}
const_assert_eq!(
    size_of::<GlobalTraderMarketInfo>(),
    GLOBAL_TRADER_MARKET_INFO_SIZE
);
const_assert_eq!(size_of::<GlobalTraderMarketInfo>() % 8, 0);
impl Ord for GlobalTraderMarketInfo {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.market).cmp(&(other.market))
    }
}
impl PartialOrd for GlobalTraderMarketInfo {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for GlobalTraderMarketInfo {
    fn eq(&self, other: &Self) -> bool {
        (self.market) == (other.market)
    }
}
impl Eq for GlobalTraderMarketInfo {}
impl std::fmt::Display for GlobalTraderMarketInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.market)
    }
}

impl GlobalFixed {
    pub fn new_empty(mint: &Pubkey) -> Self {
        let (vault, vault_bump) = get_global_vault_address(mint);
        GlobalFixed {
            discriminant: GLOBAL_FIXED_DISCRIMINANT,
            mint: *mint,
            vault,
            global_traders_root_index: NIL,
            free_list_head_index: NIL,
            num_bytes_allocated: 0,
            vault_bump,
            _unused_padding: [0; 3],
        }
    }
    pub fn get_global_traders_root_index(&self) -> DataIndex {
        self.global_traders_root_index
    }
    pub fn get_mint(&self) -> &Pubkey {
        &self.mint
    }
    pub fn get_vault(&self) -> &Pubkey {
        &self.vault
    }
    pub fn get_vault_bump(&self) -> u8 {
        self.vault_bump
    }
}

impl ManifestAccount for GlobalFixed {
    fn verify_discriminant(&self) -> ProgramResult {
        // Check the discriminant to make sure it is a global account.
        assert_with_msg(
            self.discriminant == GLOBAL_FIXED_DISCRIMINANT,
            ProgramError::InvalidAccountData,
            &format!(
                "Invalid market discriminant actual: {} expected: {}",
                self.discriminant, GLOBAL_FIXED_DISCRIMINANT
            ),
        )?;
        Ok(())
    }
}

impl GlobalTrader {
    pub fn new_empty(trader: &Pubkey) -> Self {
        GlobalTrader {
            trader: *trader,
            balance_atoms: GlobalAtoms::ZERO,
            global_trade_infos_root_index: NIL,
            _padding: [0; 5],
        }
    }
    pub fn get_trader(&self) -> &Pubkey {
        &self.trader
    }
}

impl GlobalTraderMarketInfo {
    pub fn new_empty(market: &Pubkey) -> Self {
        GlobalTraderMarketInfo {
            market: *market,
            num_atoms: GlobalAtoms::ZERO,
            _padding: [0; 24],
        }
    }
    pub fn get_num_atoms(&self) -> GlobalAtoms {
        self.num_atoms
    }
}

pub type GlobalTraderTree<'a> = RedBlackTree<'a, GlobalTrader>;
pub type GlobalTraderTreeReadOnly<'a> = RedBlackTreeReadOnly<'a, GlobalTrader>;
pub type GlobalTraderMarketInfoTree<'a> = RedBlackTree<'a, GlobalTraderMarketInfo>;
pub type GlobalTraderMarketInfoTreeReadOnly<'a> = RedBlackTreeReadOnly<'a, GlobalTraderMarketInfo>;

/// Fully owned Global, used in clients that can copy.
pub type GlobalValue = DynamicAccount<GlobalFixed, Vec<u8>>;
/// Full global reference type.
pub type GlobalRef<'a> = DynamicAccount<&'a GlobalFixed, &'a [u8]>;
/// Full global reference type.
pub type GlobalRefMut<'a> = DynamicAccount<&'a mut GlobalFixed, &'a mut [u8]>;

impl<Fixed: DerefOrBorrow<GlobalFixed>, Dynamic: DerefOrBorrow<[u8]>>
    DynamicAccount<Fixed, Dynamic>
{
    fn borrow_global(&self) -> GlobalRef {
        GlobalRef {
            fixed: self.fixed.deref_or_borrow(),
            dynamic: self.dynamic.deref_or_borrow(),
        }
    }

    pub fn get_balance_atoms(&self, trader: &Pubkey) -> Result<GlobalAtoms, ProgramError> {
        let DynamicAccount { fixed, dynamic } = self.borrow_global();
        let global_trader: &GlobalTrader = get_global_trader(fixed, dynamic, trader)?;
        Ok(global_trader.balance_atoms)
    }
}

impl<Fixed: DerefOrBorrowMut<GlobalFixed>, Dynamic: DerefOrBorrowMut<[u8]>>
    DynamicAccount<Fixed, Dynamic>
{
    fn borrow_mut_global(&mut self) -> GlobalRefMut {
        GlobalRefMut {
            fixed: self.fixed.deref_or_borrow_mut(),
            dynamic: self.dynamic.deref_or_borrow_mut(),
        }
    }

    pub fn global_expand(&mut self) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();

        assert_with_msg(
            fixed.free_list_head_index == NIL,
            ManifestError::InvalidFreeList,
            "Expected empty free list, but expand wasnt needed",
        )?;

        let mut free_list: FreeList<GlobalUnusedFreeListPadding> =
            FreeList::new(dynamic, fixed.free_list_head_index);

        free_list.add(fixed.num_bytes_allocated);
        fixed.num_bytes_allocated += BLOCK_SIZE as u32;
        fixed.free_list_head_index = free_list.get_head();
        Ok(())
    }

    pub fn reduce(&mut self, trader: &Pubkey, num_atoms: GlobalAtoms) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();
        let global_trader: &mut GlobalTrader = get_mut_global_trader(fixed, dynamic, trader)?;
        global_trader.balance_atoms = global_trader.balance_atoms.checked_sub(num_atoms)?;
        Ok(())
    }

    /// Add GlobalTrader to the tree of global traders
    pub fn add_trader(&mut self, trader: &Pubkey) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();

        let free_address: DataIndex = get_free_address_on_global_fixed(fixed, dynamic);
        let mut global_trader_tree: GlobalTraderTree =
            GlobalTraderTree::new(dynamic, fixed.global_traders_root_index, NIL);
        let global_trader: GlobalTrader = GlobalTrader::new_empty(trader);

        assert_with_msg(
            global_trader_tree.lookup_index(&global_trader) == NIL,
            ManifestError::AlreadyClaimedSeat,
            "Already claimed global trader seat",
        )?;

        global_trader_tree.insert(free_address, global_trader);
        fixed.global_traders_root_index = global_trader_tree.get_root_index();

        Ok(())
    }

    /// ClaimSeat on a market
    pub fn claim_seat_on_market(&mut self, trader: &Pubkey, market: &Pubkey) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();

        let free_address: DataIndex = get_free_address_on_global_fixed(fixed, dynamic);
        let global_trader: &GlobalTrader = get_global_trader(fixed, dynamic, trader)?;
        let global_trade_infos_root_index: DataIndex = global_trader.global_trade_infos_root_index;

        let mut global_trader_market_info_tree: GlobalTraderMarketInfoTree =
            GlobalTraderMarketInfoTree::new(dynamic, global_trade_infos_root_index, NIL);

        let new_global_trader_market_info: GlobalTraderMarketInfo =
            GlobalTraderMarketInfo::new_empty(market);
        assert_with_msg(
            global_trader_market_info_tree.lookup_index(&new_global_trader_market_info) == NIL,
            ManifestError::AlreadyClaimedSeat,
            "Already claimed global trader seat",
        )?;

        global_trader_market_info_tree.insert(free_address, new_global_trader_market_info);
        let new_global_trader_market_infos_tree_root_index: DataIndex =
            global_trader_market_info_tree.get_root_index();

        let global_trader: &mut GlobalTrader = get_mut_global_trader(fixed, dynamic, trader)?;
        global_trader.global_trade_infos_root_index =
            new_global_trader_market_infos_tree_root_index;

        Ok(())
    }

    /// Add global order to the global account and specific market.
    pub fn add_order(
        &mut self,
        resting_order: &RestingOrder,
        trader: &Pubkey,
        market: &Pubkey,
    ) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();
        let global_trader: &GlobalTrader = get_global_trader(fixed, dynamic, trader)?;
        let global_atoms_deposited: GlobalAtoms = global_trader.balance_atoms;

        let global_trader_market_info: &mut GlobalTraderMarketInfo =
            get_mut_global_trader_market_info(fixed, dynamic, trader, market)?;

        // TODO: Gas prepayment maintenance
        let num_global_atoms: GlobalAtoms = if resting_order.get_is_bid() {
            GlobalAtoms::new(
                resting_order
                    .get_num_base_atoms()
                    .checked_mul(resting_order.get_price(), false)
                    .unwrap()
                    .as_u64(),
            )
        } else {
            GlobalAtoms::new(resting_order.get_num_base_atoms().as_u64())
        };
        global_trader_market_info.num_atoms = global_trader_market_info
            .num_atoms
            .checked_add(num_global_atoms)?;

        // Note that this is mostly just informational as a roadblock to orders
        // we are very confident will not be able to fill. Would be trivial to
        // circumvent with a flash loan. That is alright. No funds are at risk
        // because the actual funds and accounting occurs on the match.
        assert_with_msg(
            global_trader_market_info.num_atoms <= global_atoms_deposited,
            ManifestError::GlobalInsufficient,
            "Insufficient funds for global order",
        )?;
        Ok(())
    }

    /// Remove global order. Update the GlobalTraderMarketInfo.
    pub fn remove_order(
        &mut self,
        trader: &Pubkey,
        market: &Pubkey,
        num_atoms: GlobalAtoms,
    ) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();
        let global_trader_market_info: &mut GlobalTraderMarketInfo =
            get_mut_global_trader_market_info(fixed, dynamic, trader, market)?;
        global_trader_market_info.num_atoms =
            global_trader_market_info.num_atoms.checked_sub(num_atoms)?;

        Ok(())
    }

    /// Deposit to global account.
    pub fn deposit_global(&mut self, trader: &Pubkey, num_atoms: GlobalAtoms) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();
        let global_trader: &mut GlobalTrader = get_mut_global_trader(fixed, dynamic, trader)?;
        global_trader.balance_atoms = global_trader.balance_atoms.checked_add(num_atoms)?;

        Ok(())
    }
}

fn get_free_address_on_global_fixed(fixed: &mut GlobalFixed, dynamic: &mut [u8]) -> DataIndex {
    let mut free_list: FreeList<GlobalUnusedFreeListPadding> =
        FreeList::new(dynamic, fixed.free_list_head_index);
    let free_address: DataIndex = free_list.remove();
    fixed.free_list_head_index = free_list.get_head();
    free_address
}

fn get_global_trader<'a>(
    fixed: &'a GlobalFixed,
    dynamic: &'a [u8],
    trader: &'a Pubkey,
) -> Result<&'a GlobalTrader, ProgramError> {
    let global_trader_tree: GlobalTraderTreeReadOnly =
        GlobalTraderTreeReadOnly::new(dynamic, fixed.global_traders_root_index, NIL);
    let global_trader_index: DataIndex =
        global_trader_tree.lookup_index(&GlobalTrader::new_empty(trader));
    assert_with_msg(
        global_trader_index != NIL,
        ManifestError::MissingGlobal,
        "Could not find global trader",
    )?;
    let global_trader: &GlobalTrader =
        get_helper::<RBNode<GlobalTrader>>(dynamic, global_trader_index).get_value();
    Ok(global_trader)
}

fn get_mut_global_trader<'a>(
    fixed: &'a mut GlobalFixed,
    dynamic: &'a mut [u8],
    trader: &'a Pubkey,
) -> Result<&'a mut GlobalTrader, ProgramError> {
    let global_trader_tree: GlobalTraderTree =
        GlobalTraderTree::new(dynamic, fixed.global_traders_root_index, NIL);
    let global_trader_index: DataIndex =
        global_trader_tree.lookup_index(&GlobalTrader::new_empty(trader));
    assert_with_msg(
        global_trader_index != NIL,
        ManifestError::MissingGlobal,
        "Could not find global trader",
    )?;
    let global_trader: &mut GlobalTrader =
        get_mut_helper::<RBNode<GlobalTrader>>(dynamic, global_trader_index).get_mut_value();
    Ok(global_trader)
}

pub(crate) fn get_mut_global_trader_market_info<'a>(
    fixed: &'a mut GlobalFixed,
    dynamic: &'a mut [u8],
    trader: &'a Pubkey,
    market: &'a Pubkey,
) -> Result<&'a mut GlobalTraderMarketInfo, ProgramError> {
    let global_trader_tree: GlobalTraderTree =
        GlobalTraderTree::new(dynamic, fixed.global_traders_root_index, NIL);
    let global_trader_index: DataIndex =
        global_trader_tree.lookup_index(&GlobalTrader::new_empty(trader));
    assert_with_msg(
        global_trader_index != NIL,
        ManifestError::MissingGlobal,
        "Could not find global trader",
    )?;
    let global_trader: &GlobalTrader =
        get_helper::<RBNode<GlobalTrader>>(dynamic, global_trader_index).get_value();
    let global_trader_market_info_tree: GlobalTraderMarketInfoTreeReadOnly =
        GlobalTraderMarketInfoTreeReadOnly::new(
            dynamic,
            global_trader.global_trade_infos_root_index,
            NIL,
        );
    let global_trader_market_info_index: DataIndex =
        global_trader_market_info_tree.lookup_index(&GlobalTraderMarketInfo::new_empty(market));
    assert_with_msg(
        global_trader_market_info_index != NIL,
        ManifestError::MissingGlobal,
        "Could not find global trader market info",
    )?;
    let global_trader_market_info: &mut GlobalTraderMarketInfo =
        get_mut_helper::<RBNode<GlobalTraderMarketInfo>>(dynamic, global_trader_market_info_index)
            .get_mut_value();
    Ok(global_trader_market_info)
}

pub fn get_global_trader_market_info<'a>(
    fixed: &'a GlobalFixed,
    dynamic: &'a [u8],
    trader: &'a Pubkey,
    market: &'a Pubkey,
) -> Result<&'a GlobalTraderMarketInfo, ProgramError> {
    let global_trader_tree: GlobalTraderTreeReadOnly =
        GlobalTraderTreeReadOnly::new(dynamic, fixed.global_traders_root_index, NIL);
    let global_trader_index: DataIndex =
        global_trader_tree.lookup_index(&GlobalTrader::new_empty(trader));
    assert_with_msg(
        global_trader_index != NIL,
        ManifestError::MissingGlobal,
        "Could not find global trader",
    )?;
    let global_trader: &GlobalTrader =
        get_helper::<RBNode<GlobalTrader>>(dynamic, global_trader_index).get_value();
    let global_trader_market_info_tree: GlobalTraderMarketInfoTreeReadOnly =
        GlobalTraderMarketInfoTreeReadOnly::new(
            dynamic,
            global_trader.global_trade_infos_root_index,
            NIL,
        );
    let global_trader_market_info_index: DataIndex =
        global_trader_market_info_tree.lookup_index(&GlobalTraderMarketInfo::new_empty(market));
    assert_with_msg(
        global_trader_market_info_index != NIL,
        ManifestError::MissingGlobal,
        "Could not find global trader market info",
    )?;
    let global_trader_market_info: &GlobalTraderMarketInfo =
        get_helper::<RBNode<GlobalTraderMarketInfo>>(dynamic, global_trader_market_info_index)
            .get_value();
    Ok(global_trader_market_info)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_display() {
        format!("{}", GlobalTrader::default());
        format!("{}", GlobalTraderMarketInfo::default());
    }

    #[test]
    fn test_cmp() {
        // Just use token program ids since those have known sort order.
        let global_trader1: GlobalTrader = GlobalTrader::new_empty(&spl_token::id());
        let global_trader2: GlobalTrader = GlobalTrader::new_empty(&spl_token_2022::id());
        assert!(global_trader1 < global_trader2);
        assert!(global_trader1 != global_trader2);

        let global_trader_market_info1: GlobalTraderMarketInfo =
            GlobalTraderMarketInfo::new_empty(&spl_token::id());
        let global_trader_market_info2: GlobalTraderMarketInfo =
            GlobalTraderMarketInfo::new_empty(&spl_token_2022::id());
        assert!(global_trader_market_info1 < global_trader_market_info2);
        assert!(global_trader_market_info1 != global_trader_market_info2);
        assert_eq!(
            global_trader_market_info1.get_num_atoms(),
            GlobalAtoms::ZERO
        );
    }
}
