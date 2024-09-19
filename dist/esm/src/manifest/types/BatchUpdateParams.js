/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
import * as beet from '@metaplex-foundation/beet';
import { cancelOrderParamsBeet } from './CancelOrderParams';
import { placeOrderParamsBeet } from './PlaceOrderParams';
/**
 * @category userTypes
 * @category generated
 */
export const batchUpdateParamsBeet = new beet.FixableBeetArgsStruct([
    ['traderIndexHint', beet.coption(beet.u32)],
    ['cancels', beet.array(cancelOrderParamsBeet)],
    ['orders', beet.array(placeOrderParamsBeet)],
], 'BatchUpdateParams');
