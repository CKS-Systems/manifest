import { PublicKey } from '@solana/web3.js';

import { ClaimedSeat, RestingOrderInternal } from '../market';
import {
  BeetArgsStruct,
  fixedSizeUint8Array,
  u32,
  u64,
  u8,
  uniformFixedSizeArray,
} from '@metaplex-foundation/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { MarketInfoRaw, OpenOrderInternal } from '../wrapperObj';
import { RedBlackTreeNodeHeader } from './redBlackTree';

type PubkeyWrapper = {
  publicKey: PublicKey;
};

/**
 * PublicKey deserializer.
 */
export const publicKeyBeet = new BeetArgsStruct<PubkeyWrapper>(
  [['publicKey', beetPublicKey]],
  'PubkeyWrapper',
);

/**
 * RestingOrder deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/resting_order.rs
 */
export const restingOrderBeet = new BeetArgsStruct<RestingOrderInternal>(
  [
    ['traderIndex', u32],
    ['lastValidSlot', u32],
    ['numBaseAtoms', u64],
    ['sequenceNumber', u64],
    ['price', fixedSizeUint8Array(8)],
    ['padding', uniformFixedSizeArray(u64, 2)],
  ],
  'restingOrder',
);

/**
 * ClaimedSeat deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/claimed_seat.rs
 */
export const claimedSeatBeet = new BeetArgsStruct<ClaimedSeat>(
  [
    ['publicKey', beetPublicKey],
    ['baseBalance', u64],
    ['quoteBalance', u64],
  ],
  'claimedSeat',
);

/**
 * RedBlackTreeHeader deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/lib/src/red_black_tree.rs
 */
export const redBlackTreeHeaderBeet =
  new BeetArgsStruct<RedBlackTreeNodeHeader>(
    [
      ['left', u32],
      ['right', u32],
      ['parent', u32],
      ['color', u32],
    ],
    'redBlackTreeNodeHeader',
  );

/**
 * MarketInfo deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/market_info.rs
 */
export const marketInfoBeet = new BeetArgsStruct<MarketInfoRaw>(
  [
    ['market', beetPublicKey],
    ['openOrdersRootIndex', u32],
    ['traderIndex', u32],
    ['baseBalanceAtoms', u64],
    ['quoteBalanceAtoms', u64],
    ['lastUpdatedSlot', u32],
    ['padding', u32],
  ],
  'marketInfoRaw',
);

/**
 * OpenOrder (wrapper) deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/open_order.rs
 */
export const openOrderBeet = new BeetArgsStruct<OpenOrderInternal>(
  [
    ['clientOrderId', u64],
    ['orderSequenceNumber', u64],
    ['price', fixedSizeUint8Array(8)],
    ['numBaseAtoms', u64],
    ['dataIndex', u32],
    ['lastValidSlot', u32],
    ['isBid', u8],
    ['orderType', u8],
    ['padding', uniformFixedSizeArray(u8, 26)],
  ],
  'OpenOrder',
);
