/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from '@metaplex-foundation/beet';
export type BatchUpdateReturn = {
  orders: [beet.bignum, number][];
};

/**
 * @category userTypes
 * @category generated
 */
export const batchUpdateReturnBeet =
  new beet.FixableBeetArgsStruct<BatchUpdateReturn>(
    [['orders', beet.array(beet.fixedSizeTuple([beet.u64, beet.u32]))]],
    'BatchUpdateReturn',
  );
