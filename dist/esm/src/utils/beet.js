import { BeetArgsStruct, fixedSizeUint8Array, u128, u32, u64, u8, uniformFixedSizeArray, } from '@metaplex-foundation/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
/**
 * PublicKey deserializer.
 */
export const publicKeyBeet = new BeetArgsStruct([['publicKey', beetPublicKey]], 'PubkeyWrapper');
/**
 * RestingOrder deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/resting_order.rs
 */
export const restingOrderBeet = new BeetArgsStruct([
    ['price', u128],
    ['effectivePrice', u128],
    ['numBaseAtoms', u64],
    ['sequenceNumber', u64],
    ['traderIndex', u32],
    ['lastValidSlot', u32],
    // is_bid
    // order_type
    ['padding', uniformFixedSizeArray(u8, 0)],
], 'restingOrder');
/**
 * ClaimedSeat deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/claimed_seat.rs
 */
export const claimedSeatBeet = new BeetArgsStruct([
    ['publicKey', beetPublicKey],
    ['baseBalance', u64],
    ['quoteBalance', u64],
], 'claimedSeat');
/**
 * RedBlackTreeHeader deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/lib/src/red_black_tree.rs
 */
export const redBlackTreeHeaderBeet = new BeetArgsStruct([
    ['left', u32],
    ['right', u32],
    ['parent', u32],
    ['color', u32],
], 'redBlackTreeNodeHeader');
/**
 * MarketInfo deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/market_info.rs
 */
export const marketInfoBeet = new BeetArgsStruct([
    ['market', beetPublicKey],
    ['openOrdersRootIndex', u32],
    ['traderIndex', u32],
    ['baseBalanceAtoms', u64],
    ['quoteBalanceAtoms', u64],
    ['quoteVolumeAtoms', u64],
    ['lastUpdatedSlot', u32],
    ['padding', u32],
], 'marketInfoRaw');
/**
 * OpenOrder (wrapper) deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/open_order.rs
 */
export const openOrderBeet = new BeetArgsStruct([
    ['price', fixedSizeUint8Array(16)],
    ['clientOrderId', u64],
    ['orderSequenceNumber', u64],
    ['numBaseAtoms', u64],
    ['dataIndex', u32],
    ['lastValidSlot', u32],
    ['isBid', u8],
    ['orderType', u8],
    ['padding', uniformFixedSizeArray(u8, 30)],
], 'OpenOrder');
