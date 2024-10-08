/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from '@metaplex-foundation/beet';
import { OrderType, orderTypeBeet } from './OrderType';
export type PlaceOrderParams = {
  baseAtoms: beet.bignum;
  priceMantissa: number;
  priceExponent: number;
  isBid: boolean;
  lastValidSlot: number;
  orderType: OrderType;
};

/**
 * @category userTypes
 * @category generated
 */
export const placeOrderParamsBeet = new beet.BeetArgsStruct<PlaceOrderParams>(
  [
    ['baseAtoms', beet.u64],
    ['priceMantissa', beet.u32],
    ['priceExponent', beet.i8],
    ['isBid', beet.bool],
    ['lastValidSlot', beet.u32],
    ['orderType', orderTypeBeet],
  ],
  'PlaceOrderParams',
);
