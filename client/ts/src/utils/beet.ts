import { PublicKey } from '@solana/web3.js';

import { ClaimedSeat, RestingOrderInternal } from '../market';
import {
  BeetArgsStruct,
  fixedSizeUint8Array,
  u128,
  u32,
  u64,
  u8,
  uniformFixedSizeArray,
} from '@metaplex-foundation/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { MarketInfoRaw, OpenOrderInternal } from '../wrapperObj';
import { RedBlackTreeNodeHeader } from './redBlackTree';
import { GlobalDeposit } from '../global';
import { UIOpenOrderInternal } from '../uiWrapperObj';

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

// TODO: Use the shanked version of all these
/**
 * RestingOrder deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/resting_order.rs
 */
export const restingOrderBeet = new BeetArgsStruct<RestingOrderInternal>(
  [
    ['price', u128],
    ['numBaseAtoms', u64],
    ['sequenceNumber', u64],
    ['traderIndex', u32],
    ['lastValidSlot', u32],
    // is_bid
    // order_type
    ['padding', uniformFixedSizeArray(u8, 0)],
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
    ['quoteVolumeAtoms', u64],
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
    ['price', fixedSizeUint8Array(16)],
    ['clientOrderId', u64],
    ['orderSequenceNumber', u64],
    ['numBaseAtoms', u64],
    ['marketDataIndex', u32],
    ['lastValidSlot', u32],
    ['isBid', u8],
    ['orderType', u8],
    ['padding', uniformFixedSizeArray(u8, 30)],
  ],
  'OpenOrder',
);

/**
 * OpenOrder (ui wrapper) deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/ui-wrapper/src/open_order.rs
 */
export const uiOpenOrderBeet = new BeetArgsStruct<UIOpenOrderInternal>(
  [
    ['price', fixedSizeUint8Array(16)],
    ['clientOrderId', u64],
    ['orderSequenceNumber', u64],
    ['numBaseAtoms', u64],
    ['marketDataIndex', u32],
    ['lastValidSlot', u32],
    ['isBid', u8],
    ['orderType', u8],
    ['padding', uniformFixedSizeArray(u8, 30)],
  ],
  'OpenOrder',
);

/**
 * GlobalSeat deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/global.rs
 */
export const globalDepositBeet = new BeetArgsStruct<GlobalDeposit>(
  [
    ['trader', beetPublicKey],
    ['balanceAtoms', u64],
  ],
  'globalDeposit',
);
