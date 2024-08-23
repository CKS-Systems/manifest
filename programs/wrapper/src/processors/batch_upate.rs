use std::{
    cell::{Ref, RefMut},
    mem::size_of,
};

use borsh::{BorshDeserialize, BorshSerialize};
use manifest::{
    program::{
        batch_update::{BatchUpdateReturn, CancelOrderParams, PlaceOrderParams},
        batch_update_instruction, get_dynamic_account,
    },
    quantities::{BaseAtoms, QuoteAtoms, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{MarketFixed, MarketRef, OrderType},
    validation::{ManifestAccountInfo, Program, Signer},
};
use hypertree::{
    get_helper, get_mut_helper, DataIndex, FreeList, RBNode, TreeReadOperations, NIL,
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::{get_return_data, invoke},
    pubkey::Pubkey,
    system_program,
};

use crate::{
    market_info::MarketInfo, open_order::WrapperOpenOrder,
    processors::shared::OpenOrdersTreeReadOnly, wrapper_state::ManifestWrapperStateFixed,
};

use super::shared::{
    check_signer, expand_wrapper_if_needed, get_market_info_index_for_market,
    get_wrapper_order_indexes_by_client_order_id, lookup_order_indexes_by_client_order_id, sync,
    OpenOrdersTree, UnusedWrapperFreeListPadding, WrapperStateAccountInfo,
};

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct WrapperPlaceOrderParams {
    client_order_id: u64,
    base_atoms: u64,
    price_mantissa: u32,
    price_exponent: i8,
    is_bid: bool,
    last_valid_slot: u32,
    order_type: OrderType,
    min_out_atoms: u64,
}
impl WrapperPlaceOrderParams {
    pub fn new(
        client_order_id: u64,
        base_atoms: u64,
        price_mantissa: u32,
        price_exponent: i8,
        is_bid: bool,
        last_valid_slot: u32,
        order_type: OrderType,
        min_out_atoms: u64,
    ) -> Self {
        WrapperPlaceOrderParams {
            client_order_id,
            base_atoms,
            price_mantissa,
            price_exponent,
            is_bid,
            last_valid_slot,
            order_type,
            min_out_atoms,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
pub struct WrapperCancelOrderParams {
    client_order_id: u64,
}
impl WrapperCancelOrderParams {
    pub fn new(client_order_id: u64) -> Self {
        WrapperCancelOrderParams { client_order_id }
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct WrapperBatchUpdateParams {
    pub cancels: Vec<WrapperCancelOrderParams>,
    pub cancel_all: bool,
    pub orders: Vec<WrapperPlaceOrderParams>,
    pub trader_index_hint: Option<DataIndex>,
}
impl WrapperBatchUpdateParams {
    pub fn new(
        cancels: Vec<WrapperCancelOrderParams>,
        cancel_all: bool,
        orders: Vec<WrapperPlaceOrderParams>,
        trader_index_hint: Option<DataIndex>,
    ) -> Self {
        WrapperBatchUpdateParams {
            cancels,
            cancel_all,
            orders,
            trader_index_hint,
        }
    }
}

pub(crate) fn process_batch_update(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
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
    let market_info_index: DataIndex = get_market_info_index_for_market(&wrapper_state, market.key);

    // Possibly expand the wrapper.
    expand_wrapper_if_needed(&wrapper_state, &payer, &system_program)?;

    // Do an initial sync to get all existing orders and balances fresh. This is
    // needed for modifying user orders for insufficient funds.
    sync(
        &wrapper_state,
        market.key,
        get_dynamic_account(&market.try_borrow_data().unwrap()),
    )?;

    // Cancels are mutable because the user may have mistakenly sent the same
    // one multiple times and the wrapper will take the responsibility for
    // deduping before forwarding to the core.
    let WrapperBatchUpdateParams {
        orders,
        cancel_all,
        mut cancels,
        trader_index_hint,
    } = WrapperBatchUpdateParams::try_from_slice(data)?;

    let wrapper_data: Ref<&mut [u8]> = wrapper_state.info.try_borrow_data()?;
    let (_fixed_data, wrapper_dynamic_data) =
        wrapper_data.split_at(size_of::<ManifestWrapperStateFixed>());

    let market_info: MarketInfo =
        *get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index).get_value();
    let mut remaining_base_atoms: BaseAtoms = market_info.base_balance;
    let mut remaining_quote_atoms: QuoteAtoms = market_info.quote_balance;
    drop(wrapper_data);

    // Delete duplicates in case the user gave multiple cancels for an individual order.
    cancels.sort_by(
        |a: &WrapperCancelOrderParams, b: &WrapperCancelOrderParams| {
            a.client_order_id.cmp(&b.client_order_id)
        },
    );
    cancels.dedup_by(
        |a: &mut WrapperCancelOrderParams, b: &mut WrapperCancelOrderParams| {
            a.client_order_id == b.client_order_id
        },
    );
    let mut core_cancels: Vec<CancelOrderParams> = cancels
        .clone()
        .into_iter()
        .map(|cancel: WrapperCancelOrderParams| {
            let order_indexes_to_remove: Vec<DataIndex> =
                get_wrapper_order_indexes_by_client_order_id(
                    &wrapper_state,
                    market.key,
                    cancel.client_order_id,
                );
            let wrapper_state_info: &AccountInfo = wrapper_state.info;
            let mut wrapper_data = wrapper_state_info.try_borrow_mut_data().unwrap();
            let (_fixed_data, wrapper_dynamic_data) =
                wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());

            order_indexes_to_remove
                .into_iter()
                .map(|order_index_to_remove: DataIndex| {
                    if order_index_to_remove != NIL {
                        let order: &WrapperOpenOrder = get_helper::<RBNode<WrapperOpenOrder>>(
                            wrapper_dynamic_data,
                            order_index_to_remove,
                        )
                        .get_value();
                        let core_cancel: CancelOrderParams = CancelOrderParams::new_with_hint(
                            order.get_order_sequence_number(),
                            Some(order.get_market_data_index()),
                        );
                        if order.get_is_bid() {
                            // Note that this uses price instead of effective
                            // price, so might not be fully accurate.
                            remaining_quote_atoms += order
                                .get_price()
                                .checked_quote_for_base(order.get_num_base_atoms(), false)
                                .unwrap();
                        } else {
                            remaining_base_atoms += order.get_num_base_atoms();
                        };
                        return core_cancel;
                    } else {
                        // Could not find the order. It has been removed, so skip it.
                        return CancelOrderParams::new_with_hint(0, Some(NIL));
                    }
                })
                .collect()
        })
        .collect::<Vec<Vec<CancelOrderParams>>>()
        .concat()
        .into_iter()
        .filter(|cancel: &CancelOrderParams| {
            cancel.order_index_hint().is_some() && cancel.order_index_hint().unwrap() != NIL
        })
        .collect();

    // If the user wants to cancel all, then ignore the cancel request and just
    // do a linear walk across the wrapper orders tree.
    if cancel_all {
        let wrapper_data: Ref<&mut [u8]> = wrapper_state.info.try_borrow_data()?;
        let (_fixed_data, wrapper_dynamic_data) =
            wrapper_data.split_at(size_of::<ManifestWrapperStateFixed>());

        let market_info: MarketInfo =
            *get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index).get_value();
        remaining_base_atoms = market_info.base_balance;
        remaining_quote_atoms = market_info.quote_balance;
        drop(wrapper_data);

        core_cancels = Vec::new();
        let wrapper_state_info: &AccountInfo = wrapper_state.info;
        let wrapper_data: Ref<&mut [u8]> = wrapper_state_info.try_borrow_data().unwrap();
        let (_fixed_data, wrapper_dynamic_data) =
            wrapper_data.split_at(size_of::<ManifestWrapperStateFixed>());

        let orders_root_index: DataIndex =
            get_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index)
                .get_value()
                .orders_root_index;
        let open_orders_tree: OpenOrdersTreeReadOnly =
            OpenOrdersTreeReadOnly::new(wrapper_dynamic_data, orders_root_index, NIL);

        for open_order_node in open_orders_tree.iter() {
            let open_order: &WrapperOpenOrder = open_order_node.1.get_value();
            core_cancels.push(CancelOrderParams::new_with_hint(
                open_order.get_order_sequence_number(),
                Some(open_order.get_market_data_index()),
            ));
            if open_order.get_is_bid() {
                remaining_quote_atoms += open_order
                    .get_price()
                    .checked_quote_for_base(open_order.get_num_base_atoms(), true)
                    .unwrap();
            } else {
                remaining_base_atoms += open_order.get_num_base_atoms();
            };
        }
    }

    let core_orders: Vec<PlaceOrderParams> = orders
        .clone()
        .into_iter()
        .map(|order: WrapperPlaceOrderParams| {
            // Possibly reduce the order due to insufficient funds. This is a
            // request from a market maker so that the whole tx doesnt roll back
            // if they do not have the funds on the exchange that the orders
            // require.
            let mut num_base_atoms: u64 = order.base_atoms;
            if order.is_bid {
                let price = QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(
                    order.price_mantissa,
                    order.price_exponent,
                )
                .unwrap();
                let desired: QuoteAtoms = BaseAtoms::new(order.base_atoms)
                    .checked_mul(price, false)
                    .unwrap();
                if desired > remaining_quote_atoms {
                    num_base_atoms = 0;
                } else {
                    remaining_quote_atoms = remaining_quote_atoms.checked_sub(desired).unwrap();
                }
            } else {
                let desired: BaseAtoms = BaseAtoms::new(order.base_atoms);
                if desired > remaining_base_atoms {
                    num_base_atoms = 0;
                } else {
                    remaining_base_atoms = remaining_base_atoms.checked_sub(desired).unwrap();
                }
            }
            let core_place: PlaceOrderParams = PlaceOrderParams::new(
                num_base_atoms,
                order.price_mantissa,
                order.price_exponent,
                order.is_bid,
                order.order_type,
                order.last_valid_slot,
            );
            core_place
        })
        .filter(|wrapper_place_orders: &PlaceOrderParams| wrapper_place_orders.base_atoms() > 0)
        .collect();

    // Call the batch update CPI
    invoke(
        &batch_update_instruction(
            market.key,
            payer.key,
            trader_index_hint,
            core_cancels.clone(),
            core_orders.clone(),
            None,
            None,
            None,
            None,
        ),
        // System program is not needed since already expanded.
        &[
            manifest_program.info.clone(),
            owner.info.clone(),
            market.info.clone(),
            system_program.info.clone(),
        ],
    )?;

    // Process the cancels
    let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state.info.try_borrow_mut_data().unwrap();
    let (fixed_data, wrapper_dynamic_data) =
        wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());

    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index)
            .get_mut_value();
    let mut orders_root_index: DataIndex = market_info.orders_root_index;

    cancels.into_iter().for_each(|cancel| {
        let order_wrapper_indexes: Vec<DataIndex> = lookup_order_indexes_by_client_order_id(
            cancel.client_order_id,
            wrapper_dynamic_data,
            orders_root_index,
        );

        order_wrapper_indexes
            .into_iter()
            .for_each(|order_wrapper_index: DataIndex| {
                let mut open_orders_tree: OpenOrdersTree =
                    OpenOrdersTree::new(wrapper_dynamic_data, orders_root_index, NIL);
                open_orders_tree.remove_by_index(order_wrapper_index);
                orders_root_index = open_orders_tree.get_root_index();
                if order_wrapper_index != NIL {
                    // Free the node in wrapper.
                    let wrapper_fixed: &mut ManifestWrapperStateFixed =
                        get_mut_helper(fixed_data, 0);
                    let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
                        FreeList::new(wrapper_dynamic_data, wrapper_fixed.free_list_head_index);
                    free_list.add(order_wrapper_index);
                    wrapper_fixed.free_list_head_index = free_list.get_head();
                }
            });
    });
    if cancel_all {
        let mut open_orders_tree: OpenOrdersTree =
            OpenOrdersTree::new(wrapper_dynamic_data, orders_root_index, NIL);
        let mut to_remove_indices: Vec<DataIndex> = Vec::new();
        for open_order in open_orders_tree.iter() {
            to_remove_indices.push(open_order.0);
        }
        for open_order_index in to_remove_indices.iter() {
            open_orders_tree.remove_by_index(*open_order_index);
        }
        orders_root_index = open_orders_tree.get_root_index();

        let wrapper_fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);
        let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
            FreeList::new(wrapper_dynamic_data, wrapper_fixed.free_list_head_index);
        for open_order_index in to_remove_indices.iter() {
            // Free the node in wrapper.
            free_list.add(*open_order_index);
        }
        wrapper_fixed.free_list_head_index = free_list.get_head();
    }

    let market_info: &mut MarketInfo =
        get_mut_helper::<RBNode<MarketInfo>>(wrapper_dynamic_data, market_info_index)
            .get_mut_value();
    market_info.orders_root_index = orders_root_index;
    drop(wrapper_data);

    let wrapper_state_info: &AccountInfo = wrapper_state.info;

    let cpi_return_data: Option<(Pubkey, Vec<u8>)> = get_return_data();
    let BatchUpdateReturn {
        orders: batch_update_orders,
    } = BatchUpdateReturn::try_from_slice(&cpi_return_data.unwrap().1[..])?;
    for (index, &(order_sequence_number, order_index)) in batch_update_orders.iter().enumerate() {
        // Order index is NIL when it did not rest. In that case, do not need to store in wrapper.
        if order_index == NIL {
            continue;
        }

        // Add to client order id tree
        let mut wrapper_data: RefMut<&mut [u8]> = wrapper_state_info.try_borrow_mut_data().unwrap();
        let (fixed_data, dynamic_data) =
            wrapper_data.split_at_mut(size_of::<ManifestWrapperStateFixed>());

        let orders_root_index: DataIndex = {
            let market_info: &mut MarketInfo =
                get_mut_helper::<RBNode<MarketInfo>>(dynamic_data, market_info_index)
                    .get_mut_value();
            market_info.orders_root_index
        };

        let wrapper_fixed: &mut ManifestWrapperStateFixed = get_mut_helper(fixed_data, 0);
        let wrapper_new_order_index: DataIndex = {
            let mut free_list: FreeList<UnusedWrapperFreeListPadding> =
                FreeList::new(dynamic_data, wrapper_fixed.free_list_head_index);
            let new_index: DataIndex = free_list.remove();
            wrapper_fixed.free_list_head_index = free_list.get_head();
            new_index
        };

        let original_order: &WrapperPlaceOrderParams = &orders[index];
        let price = QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(
            original_order.price_mantissa,
            original_order.price_exponent,
        )?;
        let order: WrapperOpenOrder = WrapperOpenOrder::new(
            original_order.client_order_id,
            order_sequence_number,
            price,
            // Base atoms can be wrong, will be fixed in the sync.
            original_order.base_atoms,
            original_order.last_valid_slot,
            order_index,
            original_order.is_bid,
            original_order.order_type,
        );

        let mut open_orders_tree: OpenOrdersTree =
            OpenOrdersTree::new(dynamic_data, orders_root_index, NIL);
        open_orders_tree.insert(wrapper_new_order_index, order);
        let new_root_index: DataIndex = open_orders_tree.get_root_index();
        let market_info: &mut MarketInfo =
            get_mut_helper::<RBNode<MarketInfo>>(dynamic_data, market_info_index).get_mut_value();
        market_info.orders_root_index = new_root_index;

        drop(wrapper_data);
        expand_wrapper_if_needed(&wrapper_state, &payer, &system_program)?;
    }
    // TODO: Enforce min_out_atoms

    // Sync to get the balance correct and remove any expired orders.
    let market_data: Ref<&mut [u8]> = market.try_borrow_data().unwrap();
    let market_ref: MarketRef = get_dynamic_account(&market_data);

    sync(&wrapper_state, market.key, market_ref)?;

    Ok(())
}
