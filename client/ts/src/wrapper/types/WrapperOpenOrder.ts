/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from '@metaplex-foundation/beet';
import { OrderType, orderTypeBeet } from './OrderType';
export type WrapperOpenOrder = {
  price: beet.bignum;
  clientOrderId: beet.bignum;
  orderSequenceNumber: beet.bignum;
  numBaseAtoms: beet.bignum;
  marketDataIndex: number;
  lastValidSlot: number;
  isBid: boolean;
  orderType: OrderType;
  padding: number[] /* size: 30 */;
};

/**
 * @category userTypes
 * @category generated
 */
export const wrapperOpenOrderBeet = new beet.BeetArgsStruct<WrapperOpenOrder>(
  [
    ['price', beet.u128],
    ['clientOrderId', beet.u64],
    ['orderSequenceNumber', beet.u64],
    ['numBaseAtoms', beet.u64],
    ['marketDataIndex', beet.u32],
    ['lastValidSlot', beet.u32],
    ['isBid', beet.bool],
    ['orderType', orderTypeBeet],
    ['padding', beet.uniformFixedSizeArray(beet.u8, 30)],
  ],
  'WrapperOpenOrder',
);
