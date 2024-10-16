import {
  BeetArgsStruct,
  fixedSizeUint8Array,
  u32,
  u64,
  u8,
  uniformFixedSizeArray,
} from '@metaplex-foundation/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { OpenOrderInternal } from '../wrapperObj';
import { RedBlackTreeNodeHeader } from './redBlackTree';
import { UIOpenOrderInternal } from '../uiWrapperObj';
import { PublicKey } from '@solana/web3.js';

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
