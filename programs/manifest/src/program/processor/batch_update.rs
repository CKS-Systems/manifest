use std::cell::RefMut;

use crate::{
    logs::{emit_stack, CancelOrderLog, PlaceOrderLog},
    program::{assert_with_msg, ManifestError},
    quantities::{BaseAtoms, PriceConversionError, QuoteAtomsPerBaseAtom, WrapperU64},
    state::{
        AddOrderToMarketArgs, AddOrderToMarketResult, MarketRefMut, OrderType, RestingOrder,
        MARKET_BLOCK_SIZE,
    },
    validation::loaders::BatchUpdateContext,
};
use borsh::{BorshDeserialize, BorshSerialize};
use hypertree::{trace, DataIndex, PodBool};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program::set_return_data, pubkey::Pubkey,
};

use super::{expand_market_if_needed, shared::get_mut_dynamic_account};

#[derive(Debug, BorshDeserialize, BorshSerialize, Clone)]
pub struct CancelOrderParams {
    order_sequence_number: u64,
    order_index_hint: Option<DataIndex>,
}

impl CancelOrderParams {
    pub fn new(order_sequence_number: u64) -> Self {
        CancelOrderParams {
            order_sequence_number,
            order_index_hint: None,
        }
    }
    pub fn new_with_hint(order_sequence_number: u64, order_index_hint: Option<DataIndex>) -> Self {
        CancelOrderParams {
            order_sequence_number,
            order_index_hint,
        }
    }
    pub fn order_sequence_number(&self) -> u64 {
        self.order_sequence_number
    }
    pub fn order_index_hint(&self) -> Option<DataIndex> {
        self.order_index_hint
    }
}

#[derive(Debug, BorshDeserialize, BorshSerialize, Clone)]
pub struct PlaceOrderParams {
    base_atoms: u64,
    price_mantissa: u32,
    price_exponent: i8,
    is_bid: bool,
    last_valid_slot: u32,
    order_type: OrderType,
}

impl PlaceOrderParams {
    pub fn new(
        base_atoms: u64,
        price_mantissa: u32,
        price_exponent: i8,
        is_bid: bool,
        order_type: OrderType,
        last_valid_slot: u32,
    ) -> Self {
        PlaceOrderParams {
            base_atoms,
            price_mantissa,
            price_exponent,
            is_bid,
            order_type,
            last_valid_slot,
        }
    }
    pub fn base_atoms(&self) -> u64 {
        self.base_atoms
    }
    pub fn try_price(&self) -> Result<QuoteAtomsPerBaseAtom, PriceConversionError> {
        QuoteAtomsPerBaseAtom::try_from_mantissa_and_exponent(
            self.price_mantissa,
            self.price_exponent,
        )
    }
    pub fn is_bid(&self) -> bool {
        self.is_bid
    }
    pub fn last_valid_slot(&self) -> u32 {
        self.last_valid_slot
    }
    pub fn order_type(&self) -> OrderType {
        self.order_type
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct BatchUpdateParams {
    /// Optional hint for what index the trader's ClaimedSeat is at.
    pub trader_index_hint: Option<DataIndex>,
    pub cancels: Vec<CancelOrderParams>,
    pub orders: Vec<PlaceOrderParams>,
}

impl BatchUpdateParams {
    pub fn new(
        trader_index_hint: Option<DataIndex>,
        cancels: Vec<CancelOrderParams>,
        orders: Vec<PlaceOrderParams>,
    ) -> Self {
        BatchUpdateParams {
            trader_index_hint,
            cancels,
            orders,
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct BatchUpdateReturn {
    /// Vector of tuples of (order_sequence_number, DataIndex)
    pub orders: Vec<(u64, DataIndex)>,
}

pub(crate) fn process_batch_update(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let batch_update_context: BatchUpdateContext = BatchUpdateContext::load(accounts)?;
    let BatchUpdateContext {
        market,
        payer,
        system_program,
        global_trade_accounts_opts,
    } = batch_update_context;

    let BatchUpdateParams {
        trader_index_hint,
        cancels,
        orders,
    } = BatchUpdateParams::try_from_slice(data)?;

    trace!("batch_update trader_index_hint:{trader_index_hint:?} cancels:{cancels:?} orders:{orders:?}");

    let trader_index: DataIndex = {
        let market_data: &mut RefMut<&mut [u8]> = &mut market.try_borrow_mut_data()?;
        let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);

        // hint usage is safe here and in cancel. Note that we do not use hints
        // for deposit or withdraw. We check that the hint aligns with block
        // boundaries, so the attack would have to be either giving a wrong
        // order or claimed seat. We verify signer on trader hint and trader on
        // resting order hint. That just leaves the case where the types are
        // crossed. If a user maliciously gives a RestingOrder instead of a
        // valid hint to their seat, then they would need to make the first 32
        // bytes (effective price and price), match a pubkey they controlled, we
        // assume statistically impossible. It is simple to make either the
        // effective price or price match a pubkey that you control, but then
        // you have a 1/2**128 chance the other matches.  If they managed to do
        // that though, they could place a large order that they are on the
        // other side of at a good price and cause loss of funds.

        // On the reverse case, you could grind pubkeys theoretically til you
        // match an order, but then the attack is only cancelling an order, not
        // worth the work to grind a key that matches the u32 for trader index.
        let trader_index: DataIndex = match trader_index_hint {
            None => dynamic_account.get_trader_index(payer.key),
            Some(hinted_index) => {
                assert_with_msg(
                    hinted_index % (MARKET_BLOCK_SIZE as DataIndex) == 0,
                    ManifestError::WrongIndexHintParams,
                    &format!("Invalid hint index {}", hinted_index),
                )?;
                assert_with_msg(
                    payer
                        .key
                        .eq(dynamic_account.get_trader_key_by_index(hinted_index)),
                    ManifestError::WrongIndexHintParams,
                    "Invalid trader hint",
                )?;
                hinted_index
            }
        };

        for cancel in cancels {
            // Hinted is preferred because that is O(1) to find and O(log n) to
            // remove. Without the hint, we lookup by order_sequence_number and
            // that is O(n) lookup and O(log n) delete.
            match cancel.order_index_hint() {
                None => {
                    // Cancels must succeed otherwise we fail the tx.
                    dynamic_account.cancel_order(
                        trader_index,
                        cancel.order_sequence_number(),
                        &global_trade_accounts_opts,
                    )?;
                }
                Some(hinted_cancel_index) => {
                    let order: &RestingOrder =
                        dynamic_account.get_order_by_index(hinted_cancel_index);
                    // Simple sanity check on the hint given. Make sure that it
                    // aligns with block boundaries. We do a check that it is an
                    // order owned by the payer inside the handler.
                    assert_with_msg(
                        trader_index % (MARKET_BLOCK_SIZE as DataIndex) == 0
                            && trader_index == order.get_trader_index(),
                        ManifestError::WrongIndexHintParams,
                        &format!("Invalid cancel hint index {}", hinted_cancel_index),
                    )?;
                    dynamic_account.cancel_order_by_index(
                        trader_index,
                        hinted_cancel_index,
                        &global_trade_accounts_opts,
                    )?;
                }
            };

            emit_stack(CancelOrderLog {
                market: *market.key,
                trader: *payer.key,
                order_sequence_number: cancel.order_sequence_number(),
            })?;
        }
        trader_index
    };

    // Result is a vector of (order_sequence_number, data_index)
    let mut result: Vec<(u64, DataIndex)> = Vec::with_capacity(orders.len());
    for place_order in orders {
        {
            let base_atoms: BaseAtoms = BaseAtoms::new(place_order.base_atoms());
            let price: QuoteAtomsPerBaseAtom = place_order.try_price()?;
            let order_type: OrderType = place_order.order_type();
            let last_valid_slot: u32 = place_order.last_valid_slot();

            // Need to reborrow every iteration so we can borrow later for expanding.
            let market_data: &mut RefMut<&mut [u8]> = &mut market.try_borrow_mut_data()?;
            let mut dynamic_account: MarketRefMut = get_mut_dynamic_account(market_data);

            let add_order_to_market_result: AddOrderToMarketResult =
                dynamic_account.place_order(AddOrderToMarketArgs {
                    market: *market.key,
                    trader_index,
                    num_base_atoms: base_atoms,
                    price,
                    is_bid: place_order.is_bid(),
                    last_valid_slot,
                    order_type,
                    global_trade_accounts_opts: &global_trade_accounts_opts,
                })?;

            let AddOrderToMarketResult {
                order_index,
                order_sequence_number,
                ..
            } = add_order_to_market_result;

            emit_stack(PlaceOrderLog {
                market: *market.key,
                trader: *payer.key,
                base_atoms,
                price,
                order_type,
                is_bid: PodBool::from(place_order.is_bid()),
                _padding: [0; 6],
                order_sequence_number,
                order_index,
                last_valid_slot,
            })?;
            result.push((order_sequence_number, order_index));
        }
        expand_market_if_needed(&payer, &market, &system_program)?;
    }

    let mut buffer: Vec<u8> = Vec::with_capacity(result.len());
    let return_data: BatchUpdateReturn = BatchUpdateReturn { orders: result };
    return_data.serialize(&mut buffer).unwrap();
    set_return_data(&buffer[..]);

    Ok(())
}
