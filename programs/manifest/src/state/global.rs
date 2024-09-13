/// The global order state stores information about all global orders for a given token.
///
/// The reason for global orders to be sharded by token is that it will make it
/// more effective for landing transactions. Rather than requiring a write lock
/// for state that covers all markets, you just need to write lock state that
/// covers all orders involving a given token.
use std::{cmp::Ordering, mem::size_of};

use bytemuck::{Pod, Zeroable};
use hypertree::{
    get_helper, get_mut_helper, DataIndex, FreeList, HyperTreeReadOperations,
    HyperTreeWriteOperations, RBNode, RedBlackTree, RedBlackTreeReadOnly, NIL,
};
use solana_program::{entrypoint::ProgramResult, program_error::ProgramError, pubkey::Pubkey};
use static_assertions::const_assert_eq;

use crate::{
    program::ManifestError,
    quantities::{GlobalAtoms, WrapperU64},
    require,
    validation::{
        get_global_address, get_global_vault_address, loaders::GlobalTradeAccounts, ManifestAccount,
    },
};

use super::{
    DerefOrBorrow, DerefOrBorrowMut, DynamicAccount, RestingOrder, GLOBAL_BLOCK_SIZE,
    GLOBAL_DEPOSIT_SIZE, GLOBAL_FIXED_DISCRIMINANT, GLOBAL_FIXED_SIZE, GLOBAL_FREE_LIST_BLOCK_SIZE,
    GLOBAL_TRADER_SIZE, MAX_GLOBAL_SEATS,
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

    /// Red-black tree root representing the global deposits sorted by amount.
    global_deposits_root_index: DataIndex,
    /// Max, because the Hypertree provides access to max, but the sort key is
    /// reversed so this is the smallest balance.
    global_deposits_max_index: DataIndex,

    /// LinkedList representing all free blocks that could be used for ClaimedSeats or RestingOrders
    free_list_head_index: DataIndex,

    /// Number of bytes allocated so far.
    num_bytes_allocated: DataIndex,

    vault_bump: u8,
    global_bump: u8,

    num_seats_claimed: u16,
}
const_assert_eq!(
    size_of::<GlobalFixed>(),
    8  +  // discriminant
    32 +  // mint
    32 +  // vault
    4 +   // global_seats_root_index
    4 +   // global_amounts_root_index
    4 +   // global_amounts_max_index 
    4 +   // free_list_head_index
    4 +   // num_bytes_allocated
    1 +   // vault_bump
    1 +   // global_bump
    2 // num_seats_claimed
);
const_assert_eq!(size_of::<GlobalFixed>(), GLOBAL_FIXED_SIZE);
const_assert_eq!(size_of::<GlobalFixed>() % 8, 0);

#[repr(C, packed)]
#[derive(Default, Copy, Clone, Pod, Zeroable)]
struct GlobalUnusedFreeListPadding {
    _padding: [u64; 7],
    _padding2: [u8; 4],
}
// 4 bytes are for the free list, rest is payload.
const_assert_eq!(
    size_of::<GlobalUnusedFreeListPadding>(),
    GLOBAL_FREE_LIST_BLOCK_SIZE
);
// Does not need to align to word boundaries because does not deserialize.

#[repr(C)]
#[derive(Default, Copy, Clone, Zeroable, Pod)]
pub struct GlobalTrader {
    /// Trader who controls this global trader.
    trader: Pubkey,

    // Number of gas deposits on the global account. This is the number of gas
    // deposits that were paid by the global trader, but were not taken when the
    // order was removed. Informational purposes only.
    unclaimed_gas_deposits: u32,

    deposit_index: DataIndex,
    _padding: u64,
}
const_assert_eq!(size_of::<GlobalTrader>(), GLOBAL_TRADER_SIZE);
const_assert_eq!(size_of::<GlobalTrader>() % 8, 0);

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

#[repr(C)]
#[derive(Default, Copy, Clone, Zeroable, Pod)]
pub struct GlobalDeposit {
    /// Trader who controls this global trader.
    trader: Pubkey,

    /// Token balance in the global account for this trader. The tokens received
    /// in trades stay in the market.
    balance_atoms: GlobalAtoms,
    _padding: u64,
}
const_assert_eq!(size_of::<GlobalDeposit>(), GLOBAL_DEPOSIT_SIZE);
const_assert_eq!(size_of::<GlobalDeposit>() % 8, 0);

impl Ord for GlobalDeposit {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reversed order so that the max according to the tree is actually the min.
        (other.balance_atoms).cmp(&(self.balance_atoms))
    }
}
impl PartialOrd for GlobalDeposit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for GlobalDeposit {
    fn eq(&self, other: &Self) -> bool {
        (self.trader) == (other.trader)
    }
}
impl Eq for GlobalDeposit {}
impl std::fmt::Display for GlobalDeposit {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.trader)
    }
}

impl GlobalFixed {
    pub fn new_empty(mint: &Pubkey) -> Self {
        let (vault, vault_bump) = get_global_vault_address(mint);
        let (_, global_bump) = get_global_address(mint);
        GlobalFixed {
            discriminant: GLOBAL_FIXED_DISCRIMINANT,
            mint: *mint,
            vault,
            global_traders_root_index: NIL,
            global_deposits_root_index: NIL,
            global_deposits_max_index: NIL,
            free_list_head_index: NIL,
            num_bytes_allocated: 0,
            vault_bump,
            global_bump,
            num_seats_claimed: 0,
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
    pub fn get_global_bump(&self) -> u8 {
        self.global_bump
    }
}

impl ManifestAccount for GlobalFixed {
    fn verify_discriminant(&self) -> ProgramResult {
        // Check the discriminant to make sure it is a global account.
        require!(
            self.discriminant == GLOBAL_FIXED_DISCRIMINANT,
            ProgramError::InvalidAccountData,
            "Invalid market discriminant actual: {} expected: {}",
            self.discriminant,
            GLOBAL_FIXED_DISCRIMINANT
        )?;
        Ok(())
    }
}

impl GlobalTrader {
    pub fn new_empty(trader: &Pubkey, deposit_index: DataIndex) -> Self {
        GlobalTrader {
            trader: *trader,
            unclaimed_gas_deposits: 0,
            deposit_index,
            _padding: 0,
        }
    }
    pub fn get_trader(&self) -> &Pubkey {
        &self.trader
    }
}

impl GlobalDeposit {
    pub fn new_empty(trader: &Pubkey) -> Self {
        GlobalDeposit {
            trader: *trader,
            balance_atoms: GlobalAtoms::ZERO,
            _padding: 0,
        }
    }
    pub fn get_trader(&self) -> &Pubkey {
        &self.trader
    }
}

pub type GlobalTraderTree<'a> = RedBlackTree<'a, GlobalTrader>;
pub type GlobalTraderTreeReadOnly<'a> = RedBlackTreeReadOnly<'a, GlobalTrader>;
pub type GlobalDepositTree<'a> = RedBlackTree<'a, GlobalDeposit>;
pub type GlobalDepositTreeReadOnly<'a> = RedBlackTreeReadOnly<'a, GlobalDeposit>;

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

    pub fn get_balance_atoms(&self, trader: &Pubkey) -> GlobalAtoms {
        let DynamicAccount { fixed, dynamic } = self.borrow_global();
        // If the trader got evicted, then they wont be found.
        let global_balance_or: Option<&GlobalDeposit> = get_global_deposit(fixed, dynamic, trader);
        if let Some(global_deposit) = global_balance_or {
            global_deposit.balance_atoms
        } else {
            GlobalAtoms::ZERO
        }
    }

    pub fn verify_min_balance(&self, trader: &Pubkey) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_global();

        let existing_global_trader_opt: Option<&GlobalTrader> =
            get_global_trader(fixed, dynamic, trader);
        require!(
            existing_global_trader_opt.is_some(),
            ManifestError::MissingGlobal,
            "Could not find global trader for {}",
            trader
        )?;
        let existing_global_trader: GlobalTrader = *existing_global_trader_opt.unwrap();
        let global_trader_tree: GlobalTraderTreeReadOnly = GlobalTraderTreeReadOnly::new(
            dynamic,
            fixed.global_traders_root_index,
            fixed.global_deposits_max_index,
        );
        let existing_trader_index: DataIndex =
            global_trader_tree.lookup_index(&existing_global_trader);
        let existing_global_trader: &GlobalTrader =
            get_helper::<RBNode<GlobalTrader>>(dynamic, existing_trader_index).get_value();
        let existing_deposit_index: DataIndex = existing_global_trader.deposit_index;

        require!(
            existing_deposit_index == fixed.global_deposits_max_index,
            ManifestError::GlobalInsufficient,
            "Only can remove trader with lowest deposit"
        )?;

        Ok(())
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

        require!(
            fixed.free_list_head_index == NIL,
            ManifestError::InvalidFreeList,
            "Expected empty free list, but expand wasnt needed",
        )?;

        let mut free_list: FreeList<GlobalUnusedFreeListPadding> =
            FreeList::new(dynamic, fixed.free_list_head_index);

        // Expand twice since there are two trees.
        free_list.add(fixed.num_bytes_allocated);
        free_list.add(fixed.num_bytes_allocated + GLOBAL_BLOCK_SIZE as u32);
        fixed.num_bytes_allocated += 2 * GLOBAL_BLOCK_SIZE as u32;
        fixed.free_list_head_index = free_list.get_head();
        Ok(())
    }

    pub fn reduce(&mut self, trader: &Pubkey, num_atoms: GlobalAtoms) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();
        let global_deposit_opt: Option<&mut GlobalDeposit> =
            get_mut_global_deposit(fixed, dynamic, trader);
        require!(
            global_deposit_opt.is_some(),
            ManifestError::MissingGlobal,
            "Could not find global deposit for {}",
            trader
        )?;
        let global_deposit: &mut GlobalDeposit = global_deposit_opt.unwrap();
        global_deposit.balance_atoms = global_deposit.balance_atoms.checked_sub(num_atoms)?;
        Ok(())
    }

    /// Add GlobalTrader to the tree of global traders
    pub fn add_trader(&mut self, trader: &Pubkey) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();

        let free_address_trader: DataIndex = get_free_address_on_global_fixed(fixed, dynamic);
        let free_address_deposit: DataIndex = get_free_address_on_global_fixed(fixed, dynamic);
        let mut global_trader_tree: GlobalTraderTree =
            GlobalTraderTree::new(dynamic, fixed.global_traders_root_index, NIL);
        let global_trader: GlobalTrader = GlobalTrader::new_empty(trader, free_address_deposit);

        require!(
            global_trader_tree.lookup_index(&global_trader) == NIL,
            ManifestError::AlreadyClaimedSeat,
            "Already claimed global trader seat",
        )?;

        global_trader_tree.insert(free_address_trader, global_trader);
        fixed.global_traders_root_index = global_trader_tree.get_root_index();
        require!(
            fixed.num_seats_claimed < MAX_GLOBAL_SEATS,
            ManifestError::TooManyGlobalSeats,
            "There is a strict limit on number of seats available in a global, use evict",
        )?;

        fixed.num_seats_claimed += 1;

        let global_deposit: GlobalDeposit = GlobalDeposit::new_empty(trader);
        let mut global_deposit_tree: GlobalDepositTree = GlobalDepositTree::new(
            dynamic,
            fixed.global_deposits_root_index,
            fixed.global_deposits_max_index,
        );
        global_deposit_tree.insert(free_address_deposit, global_deposit);
        fixed.global_deposits_root_index = global_deposit_tree.get_root_index();
        fixed.global_deposits_max_index = global_deposit_tree.get_max_index();

        Ok(())
    }

    /// Evict from the global account and steal their seat
    pub fn evict_and_take_seat(
        &mut self,
        existing_trader: &Pubkey,
        new_trader: &Pubkey,
    ) -> ProgramResult {
        // TODO: Make this expensive so it cannot be composed and used in attacks where bumping.
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();

        let existing_global_trader_opt: Option<&GlobalTrader> =
            get_global_trader(fixed, dynamic, existing_trader);
        require!(
            existing_global_trader_opt.is_some(),
            ManifestError::MissingGlobal,
            "Could not find global trader for {}",
            existing_trader
        )?;
        let existing_global_trader: GlobalTrader = *existing_global_trader_opt.unwrap();

        let existing_global_deposit_opt: Option<&mut GlobalDeposit> =
            get_mut_global_deposit(fixed, dynamic, existing_trader);
        require!(
            existing_global_deposit_opt.is_some(),
            ManifestError::MissingGlobal,
            "Could not find global deposit for {}",
            existing_trader
        )?;
        let existing_global_deposit: &mut GlobalDeposit = existing_global_deposit_opt.unwrap();

        let existing_global_atoms_deposited: GlobalAtoms = existing_global_deposit.balance_atoms;
        require!(
            existing_global_atoms_deposited == GlobalAtoms::ZERO,
            ManifestError::GlobalInsufficient,
            "Error in emptying the existing global",
        )?;

        // Verification that the max index is the deposit index we are taking happens before withdraw.
        let global_trader_tree: GlobalTraderTree =
            GlobalTraderTree::new(dynamic, fixed.global_traders_root_index, NIL);
        let existing_trader_index: DataIndex =
            global_trader_tree.lookup_index(&existing_global_trader);
        let existing_global_trader: &GlobalTrader =
            get_helper::<RBNode<GlobalTrader>>(dynamic, existing_trader_index).get_value();
        let existing_deposit_index: DataIndex = existing_global_trader.deposit_index;

        // Update global trader
        {
            let mut global_trader_tree: GlobalTraderTree =
                GlobalTraderTree::new(dynamic, fixed.global_traders_root_index, NIL);
            require!(
                existing_deposit_index == fixed.global_deposits_max_index,
                ManifestError::GlobalInsufficient,
                "Only can remove trader with lowest deposit"
            )?;
            let new_global_trader: GlobalTrader =
                GlobalTrader::new_empty(new_trader, fixed.global_deposits_max_index);

            global_trader_tree.remove_by_index(existing_trader_index);

            // Cannot claim an extra seat.
            require!(
                global_trader_tree.lookup_index(&new_global_trader) == NIL,
                ManifestError::AlreadyClaimedSeat,
                "Already claimed global trader seat",
            )?;

            global_trader_tree.insert(existing_trader_index, new_global_trader);
            fixed.global_traders_root_index = global_trader_tree.get_root_index();
        }

        // Update global deposits
        {
            let new_global_deposit: GlobalDeposit = GlobalDeposit::new_empty(new_trader);
            let mut global_deposit_tree: GlobalDepositTree = GlobalDepositTree::new(
                dynamic,
                fixed.global_deposits_root_index,
                fixed.global_deposits_max_index,
            );
            global_deposit_tree.remove_by_index(existing_deposit_index);
            global_deposit_tree.insert(existing_deposit_index, new_global_deposit);
            fixed.global_deposits_max_index = global_deposit_tree.get_max_index();
            fixed.global_deposits_root_index = global_deposit_tree.get_root_index();
        }

        Ok(())
    }

    /// Add global order to the global account and specific market.
    pub fn add_order(
        &mut self,
        resting_order: &RestingOrder,
        global_trade_owner: &Pubkey,
    ) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();

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

        // Verify that there are enough deposited atoms.
        {
            let global_deposit_opt: Option<&mut GlobalDeposit> =
                get_mut_global_deposit(fixed, dynamic, global_trade_owner);
            require!(
                global_deposit_opt.is_some(),
                ManifestError::MissingGlobal,
                "Could not find global deposit for {}",
                global_trade_owner
            )?;
            let global_deposit: &mut GlobalDeposit = global_deposit_opt.unwrap();

            let global_atoms_deposited: GlobalAtoms = global_deposit.balance_atoms;

            // This can be trivial to circumvent by using flash loans. This is just
            // an informational safety check.
            require!(
                num_global_atoms <= global_atoms_deposited,
                ManifestError::GlobalInsufficient,
                "Insufficient funds for global order",
            )?;
        }

        Ok(())
    }

    /// Remove global order. Update the GlobalTrader.
    pub fn remove_order(
        &mut self,
        global_trade_owner: &Pubkey,
        global_trade_accounts: &GlobalTradeAccounts,
    ) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();
        // Might not exist because of eviction.
        if let Ok(global_trader) = get_mut_global_trader(fixed, dynamic, global_trade_owner) {
            let GlobalTradeAccounts { trader, .. } = global_trade_accounts;
            if trader.info.key != global_trade_owner
                || global_trade_accounts.system_program.is_none()
            {
                global_trader.unclaimed_gas_deposits += 1;
            }
        }

        Ok(())
    }

    /// Deposit to global account.
    pub fn deposit_global(&mut self, trader: &Pubkey, num_atoms: GlobalAtoms) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();
        let global_deposit_opt: Option<&mut GlobalDeposit> =
            get_mut_global_deposit(fixed, dynamic, trader);
        require!(
            global_deposit_opt.is_some(),
            ManifestError::MissingGlobal,
            "Could not find global deposit for {}",
            trader
        )?;
        let global_deposit: &mut GlobalDeposit = global_deposit_opt.unwrap();
        global_deposit.balance_atoms = global_deposit.balance_atoms.checked_add(num_atoms)?;

        Ok(())
    }

    /// Withdraw from global account.
    pub fn withdraw_global(&mut self, trader: &Pubkey, num_atoms: GlobalAtoms) -> ProgramResult {
        let DynamicAccount { fixed, dynamic } = self.borrow_mut_global();
        let global_deposit_opt: Option<&mut GlobalDeposit> =
            get_mut_global_deposit(fixed, dynamic, trader);
        require!(
            global_deposit_opt.is_some(),
            ManifestError::MissingGlobal,
            "Could not find global deposit for {}",
            trader
        )?;
        let global_deposit: &mut GlobalDeposit = global_deposit_opt.unwrap();
        // Checked sub makes sure there are enough funds.
        global_deposit.balance_atoms = global_deposit.balance_atoms.checked_sub(num_atoms)?;

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
) -> Option<&'a GlobalTrader> {
    let global_trader_tree: GlobalTraderTreeReadOnly =
        GlobalTraderTreeReadOnly::new(dynamic, fixed.global_traders_root_index, NIL);
    let global_trader_index: DataIndex =
        global_trader_tree.lookup_index(&GlobalTrader::new_empty(trader, NIL));
    if global_trader_index == NIL {
        return None;
    }
    let global_trader: &GlobalTrader =
        get_helper::<RBNode<GlobalTrader>>(dynamic, global_trader_index).get_value();
    Some(global_trader)
}

fn get_mut_global_trader<'a>(
    fixed: &'a mut GlobalFixed,
    dynamic: &'a mut [u8],
    trader: &'a Pubkey,
) -> Result<&'a mut GlobalTrader, ProgramError> {
    let global_trader_tree: GlobalTraderTree =
        GlobalTraderTree::new(dynamic, fixed.global_traders_root_index, NIL);
    let global_trader_index: DataIndex =
        global_trader_tree.lookup_index(&GlobalTrader::new_empty(trader, NIL));
    require!(
        global_trader_index != NIL,
        ManifestError::MissingGlobal,
        "Could not find global trader",
    )?;
    let global_trader: &mut GlobalTrader =
        get_mut_helper::<RBNode<GlobalTrader>>(dynamic, global_trader_index).get_mut_value();
    Ok(global_trader)
}

fn get_mut_global_deposit<'a>(
    fixed: &'a mut GlobalFixed,
    dynamic: &'a mut [u8],
    trader: &'a Pubkey,
) -> Option<&'a mut GlobalDeposit> {
    let global_trader_tree: GlobalTraderTree =
        GlobalTraderTree::new(dynamic, fixed.global_traders_root_index, NIL);
    let global_trader_index: DataIndex =
        global_trader_tree.lookup_index(&GlobalTrader::new_empty(trader, NIL));
    if global_trader_index == NIL {
        return None;
    }
    let global_trader: &GlobalTrader =
        get_helper::<RBNode<GlobalTrader>>(dynamic, global_trader_index).get_value();
    let global_deposit_index: DataIndex = global_trader.deposit_index;
    Some(get_mut_helper::<RBNode<GlobalDeposit>>(dynamic, global_deposit_index).get_mut_value())
}

fn get_global_deposit<'a>(
    fixed: &'a GlobalFixed,
    dynamic: &'a [u8],
    trader: &'a Pubkey,
) -> Option<&'a GlobalDeposit> {
    let global_trader_tree: GlobalTraderTreeReadOnly =
        GlobalTraderTreeReadOnly::new(dynamic, fixed.global_traders_root_index, NIL);
    let global_trader_index: DataIndex =
        global_trader_tree.lookup_index(&GlobalTrader::new_empty(trader, NIL));
    if global_trader_index == NIL {
        return None;
    }
    let global_trader: &GlobalTrader =
        get_helper::<RBNode<GlobalTrader>>(dynamic, global_trader_index).get_value();
    let global_deposit_index: DataIndex = global_trader.deposit_index;
    Some(get_helper::<RBNode<GlobalDeposit>>(dynamic, global_deposit_index).get_value())
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_display() {
        format!("{}", GlobalTrader::default());
    }

    #[test]
    fn test_cmp() {
        // Just use token program ids since those have known sort order.
        let global_trader1: GlobalTrader = GlobalTrader::new_empty(&spl_token::id(), NIL);
        let global_trader2: GlobalTrader = GlobalTrader::new_empty(&spl_token_2022::id(), NIL);
        assert!(global_trader1 < global_trader2);
        assert!(global_trader1 != global_trader2);
    }
}
