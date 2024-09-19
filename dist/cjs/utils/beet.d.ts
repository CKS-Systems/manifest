import { PublicKey } from '@solana/web3.js';
import { ClaimedSeat, RestingOrderInternal } from '../market';
import { BeetArgsStruct } from '@metaplex-foundation/beet';
import { MarketInfoRaw, OpenOrderInternal } from '../wrapperObj';
import { RedBlackTreeNodeHeader } from './redBlackTree';
type PubkeyWrapper = {
    publicKey: PublicKey;
};
/**
 * PublicKey deserializer.
 */
export declare const publicKeyBeet: BeetArgsStruct<PubkeyWrapper>;
/**
 * RestingOrder deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/resting_order.rs
 */
export declare const restingOrderBeet: BeetArgsStruct<RestingOrderInternal>;
/**
 * ClaimedSeat deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/claimed_seat.rs
 */
export declare const claimedSeatBeet: BeetArgsStruct<ClaimedSeat>;
/**
 * RedBlackTreeHeader deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/lib/src/red_black_tree.rs
 */
export declare const redBlackTreeHeaderBeet: BeetArgsStruct<RedBlackTreeNodeHeader>;
/**
 * MarketInfo deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/market_info.rs
 */
export declare const marketInfoBeet: BeetArgsStruct<MarketInfoRaw>;
/**
 * OpenOrder (wrapper) deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/open_order.rs
 */
export declare const openOrderBeet: BeetArgsStruct<OpenOrderInternal>;
export {};
