/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from '@metaplex-foundation/beet';
import * as web3 from '@solana/web3.js';
import * as beetSolana from '@metaplex-foundation/beet-solana';
export type MarketFixed = {
  discriminant: beet.bignum;
  version: number;
  baseMintDecimals: number;
  quoteMintDecimals: number;
  baseVaultBump: number;
  quoteVaultBump: number;
  padding1: number[] /* size: 3 */;
  baseMint: web3.PublicKey;
  quoteMint: web3.PublicKey;
  baseVault: web3.PublicKey;
  quoteVault: web3.PublicKey;
  orderSequenceNumber: beet.bignum;
  numBytesAllocated: number;
  bidsRootIndex: number;
  bidsBestIndex: number;
  asksRootIndex: number;
  asksBestIndex: number;
  claimedSeatsRootIndex: number;
  freeListHeadIndex: number;
  padding2: number[] /* size: 1 */;
  quoteVolume: beet.bignum;
  padding3: beet.bignum[] /* size: 8 */;
};

/**
 * @category userTypes
 * @category generated
 */
export const marketFixedBeet = new beet.BeetArgsStruct<MarketFixed>(
  [
    ['discriminant', beet.u64],
    ['version', beet.u8],
    ['baseMintDecimals', beet.u8],
    ['quoteMintDecimals', beet.u8],
    ['baseVaultBump', beet.u8],
    ['quoteVaultBump', beet.u8],
    ['padding1', beet.uniformFixedSizeArray(beet.u8, 3)],
    ['baseMint', beetSolana.publicKey],
    ['quoteMint', beetSolana.publicKey],
    ['baseVault', beetSolana.publicKey],
    ['quoteVault', beetSolana.publicKey],
    ['orderSequenceNumber', beet.u64],
    ['numBytesAllocated', beet.u32],
    ['bidsRootIndex', beet.u32],
    ['bidsBestIndex', beet.u32],
    ['asksRootIndex', beet.u32],
    ['asksBestIndex', beet.u32],
    ['claimedSeatsRootIndex', beet.u32],
    ['freeListHeadIndex', beet.u32],
    ['padding2', beet.uniformFixedSizeArray(beet.u32, 1)],
    ['quoteVolume', beet.u64],
    ['padding3', beet.uniformFixedSizeArray(beet.u64, 8)],
  ],
  'MarketFixed',
);
