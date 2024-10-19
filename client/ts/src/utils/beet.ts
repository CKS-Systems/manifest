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
