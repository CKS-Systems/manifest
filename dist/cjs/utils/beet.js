"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openOrderBeet = exports.marketInfoBeet = exports.redBlackTreeHeaderBeet = exports.claimedSeatBeet = exports.restingOrderBeet = exports.publicKeyBeet = void 0;
const beet_1 = require("@metaplex-foundation/beet");
const beet_solana_1 = require("@metaplex-foundation/beet-solana");
/**
 * PublicKey deserializer.
 */
exports.publicKeyBeet = new beet_1.BeetArgsStruct([['publicKey', beet_solana_1.publicKey]], 'PubkeyWrapper');
/**
 * RestingOrder deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/resting_order.rs
 */
exports.restingOrderBeet = new beet_1.BeetArgsStruct([
    ['price', beet_1.u128],
    ['effectivePrice', beet_1.u128],
    ['numBaseAtoms', beet_1.u64],
    ['sequenceNumber', beet_1.u64],
    ['traderIndex', beet_1.u32],
    ['lastValidSlot', beet_1.u32],
    // is_bid
    // order_type
    ['padding', (0, beet_1.uniformFixedSizeArray)(beet_1.u8, 0)],
], 'restingOrder');
/**
 * ClaimedSeat deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/claimed_seat.rs
 */
exports.claimedSeatBeet = new beet_1.BeetArgsStruct([
    ['publicKey', beet_solana_1.publicKey],
    ['baseBalance', beet_1.u64],
    ['quoteBalance', beet_1.u64],
], 'claimedSeat');
/**
 * RedBlackTreeHeader deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/lib/src/red_black_tree.rs
 */
exports.redBlackTreeHeaderBeet = new beet_1.BeetArgsStruct([
    ['left', beet_1.u32],
    ['right', beet_1.u32],
    ['parent', beet_1.u32],
    ['color', beet_1.u32],
], 'redBlackTreeNodeHeader');
/**
 * MarketInfo deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/market_info.rs
 */
exports.marketInfoBeet = new beet_1.BeetArgsStruct([
    ['market', beet_solana_1.publicKey],
    ['openOrdersRootIndex', beet_1.u32],
    ['traderIndex', beet_1.u32],
    ['baseBalanceAtoms', beet_1.u64],
    ['quoteBalanceAtoms', beet_1.u64],
    ['quoteVolumeAtoms', beet_1.u64],
    ['lastUpdatedSlot', beet_1.u32],
    ['padding', beet_1.u32],
], 'marketInfoRaw');
/**
 * OpenOrder (wrapper) deserializer.
 *
 * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/open_order.rs
 */
exports.openOrderBeet = new beet_1.BeetArgsStruct([
    ['price', (0, beet_1.fixedSizeUint8Array)(16)],
    ['clientOrderId', beet_1.u64],
    ['orderSequenceNumber', beet_1.u64],
    ['numBaseAtoms', beet_1.u64],
    ['dataIndex', beet_1.u32],
    ['lastValidSlot', beet_1.u32],
    ['isBid', beet_1.u8],
    ['orderType', beet_1.u8],
    ['padding', (0, beet_1.uniformFixedSizeArray)(beet_1.u8, 30)],
], 'OpenOrder');
