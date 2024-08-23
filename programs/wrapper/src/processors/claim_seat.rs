use std::{cell::RefMut, mem::size_of};

use hypertree::{get_mut_helper, DataIndex, FreeList, TreeReadOperations, NIL};
use manifest::{
    program::{claim_seat_instruction, expand_instruction, get_mut_dynamic_account},
    state::{MarketFixed, MarketRefMut},
    validation::ManifestAccountInfo,
};

use crate::{market_info::MarketInfo, wrapper_state::ManifestWrapperStateFixed};
use manifest::validation::{Program, Signer};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke,
    pubkey::Pubkey,
    system_program,
};

use super::shared::{
    check_signer, expand_wrapper_if_needed, MarketInfosTree, UnusedWrapperFreeListPadding,
    WrapperStateAccountInfo,
};

pub(crate) fn process_claim_seat(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let account_iter: &mut std::slice::Iter<AccountInfo> = &mut accounts.iter();
    let manifest_program: Program =
        Program::new(next_account_info(account_iter)?, &manifest::id())?;
    let owner: Signer = Signer::new(next_account_info(account_iter)?)?;
    let market: ManifestAccountInfo<MarketFixed> =
        ManifestAccountInfo::<MarketFixed>::new(next_account_info(account_iter)?)?;
    let system_program: Program =
        Program::new(next_account_info(account_iter)?, &system_program::id())?;
    let payer: Signer = Signer::new(next_account_info(account_iter)?)?;
    let wrapper_state: WrapperStateAccountInfo =
        WrapperStateAccountInfo::new(next_account_info(account_iter)?)?;
    check_signer(&wrapper_state, owner.key);

    // Call the Expand CPI
    invoke(
        &expand_instruction(market.key, payer.key),
        &[
            manifest_program.info.clone(),
            owner.info.clone(),
            market.info.clone(),
            system_program.info.clone(),
        ],
    )?;

    // Call the ClaimSeat CPI
    invoke(
        &claim_seat_instruction(market.key, owner.key),
        &[
            manifest_program.info.clone(),
            owner.info.clone(),
            market.info.clone(),
            system_program.info.clone(),
        ],
    )?;

    // Insert the seat into the wrapper state
    expand_wrapper_if_needed(&wrapper_state, &payer, &system_program)?;

    // Load the market_infos tree and insert a new one
    let wrapper_state_info: &AccountInfo = wrapper_state.info;
    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state_info.try_borrow_mut_data().unwrap();
    let (fixed_data, wrapper_dynamic_data) =
        wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());
    let wrapper_fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);

    // Get the free block and setup the new MarketInfo there
    let market_data: &mut RefMut<&mut [u8]> = &mut market.try_borrow_mut_data()?;
    let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);
    let trader_index: DataIndex = dynamic_account.get_trader_index(payer.key);
    let market_info: MarketInfo = MarketInfo::new_empty(*market.key, trader_index);

    // Put that market_info at the free list head
    let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
        FreeList::new(wrapper_dynamic_data, wrapper_fixed.free_list_head_index);
    let free_address: DataIndex = free_list.remove();
    wrapper_fixed.free_list_head_index = free_list.get_head();

    // Insert into the MarketInfosTree
    let mut market_infos_tree: MarketInfosTree = MarketInfosTree::new(
        wrapper_dynamic_data,
        wrapper_fixed.market_infos_root_index,
        NIL,
    );
    market_infos_tree.insert(free_address, market_info);
    wrapper_fixed.market_infos_root_index = market_infos_tree.get_root_index();

    Ok(())
}
