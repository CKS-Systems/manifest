"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Market = void 0;
const beet_1 = require("./utils/beet");
const beet_solana_1 = require("@metaplex-foundation/beet-solana");
const redBlackTree_1 = require("./utils/redBlackTree");
const numbers_1 = require("./utils/numbers");
const constants_1 = require("./constants");
const manifest_1 = require("./manifest");
/**
 * Market object used for reading data from a manifest market.
 */
class Market {
    /** Public key for the market account. */
    address;
    /** Deserialized data. */
    data;
    /**
     * Constructs a Market object.
     *
     * @param address The `PublicKey` of the market account
     * @param data Deserialized market data
     */
    constructor({ address, data, }) {
        this.address = address;
        this.data = data;
    }
    /**
     * Returns a `Market` for a given address, a data buffer
     *
     * @param marketAddress The `PublicKey` of the market account
     * @param buffer The buffer holding the market account data
     */
    static loadFromBuffer({ address, buffer, }) {
        const marketData = Market.deserializeMarketBuffer(buffer);
        return new Market({ address, data: marketData });
    }
    /**
     * Returns a `Market` for a given address, a data buffer
     *
     * @param connection The Solana `Connection` object
     * @param address The `PublicKey` of the market account
     */
    static async loadFromAddress({ connection, address, }) {
        const buffer = await connection
            .getAccountInfo(address)
            .then((accountInfo) => accountInfo?.data);
        if (buffer === undefined) {
            throw new Error(`Failed to load ${address}`);
        }
        return Market.loadFromBuffer({ address, buffer });
    }
    /**
     * Updates the data in a Market.
     *
     * @param connection The Solana `Connection` object
     */
    async reload(connection) {
        const buffer = await connection
            .getAccountInfo(this.address)
            .then((accountInfo) => accountInfo?.data);
        if (buffer === undefined) {
            throw new Error(`Failed to load ${this.address}`);
        }
        this.data = Market.deserializeMarketBuffer(buffer);
    }
    static async findMarkets(connection, baseMint, quoteMint) {
        // Based on the MarketFixed struct
        const baseMintOffset = 16;
        const quoteMintOffset = 48;
        const filters = [
            {
                memcmp: {
                    offset: baseMintOffset,
                    bytes: baseMint.toBase58(),
                },
            },
            {
                memcmp: {
                    offset: quoteMintOffset,
                    bytes: quoteMint.toBase58(),
                },
            },
        ];
        const accounts = await connection.getProgramAccounts(manifest_1.PROGRAM_ID, {
            filters,
        });
        return accounts;
    }
    /**
     * Get the amount in tokens of balance that is deposited on this market, does
     * not include tokens currently in open orders.
     *
     * @param trader PublicKey of the trader to check balance of
     * @param isBase boolean for whether this is checking base or quote
     *
     * @returns number in tokens
     */
    getWithdrawableBalanceTokens(trader, isBase) {
        const filteredSeats = this.data.claimedSeats.filter((claimedSeat) => {
            return claimedSeat.publicKey.toBase58() == trader.toBase58();
        });
        // No seat claimed.
        if (filteredSeats.length == 0) {
            return 0;
        }
        const seat = filteredSeats[0];
        const withdrawableBalance = isBase
            ? (0, numbers_1.toNum)(seat.baseBalance) / 10 ** this.baseDecimals()
            : (0, numbers_1.toNum)(seat.quoteBalance) / 10 ** this.quoteDecimals();
        return withdrawableBalance;
    }
    /**
     * Gets the base mint of the market
     *
     * @returns PublicKey
     */
    baseMint() {
        return this.data.baseMint;
    }
    /**
     * Gets the quote mint of the market
     *
     * @returns PublicKey
     */
    quoteMint() {
        return this.data.quoteMint;
    }
    /**
     * Gets the base decimals of the market
     *
     * @returns number
     */
    baseDecimals() {
        return this.data.baseMintDecimals;
    }
    /**
     * Gets the base decimals of the market
     *
     * @returns number
     */
    quoteDecimals() {
        return this.data.quoteMintDecimals;
    }
    /**
     * Check whether a given public key has a claimed seat on the market
     *
     * @param trader PublicKey of the trader
     *
     * @returns boolean
     */
    hasSeat(trader) {
        const filteredSeats = this.data.claimedSeats.filter((claimedSeat) => {
            return claimedSeat.publicKey.toBase58() == trader.toBase58();
        });
        return filteredSeats.length > 0;
    }
    /**
     * Get all open bids on the market.
     *
     * @returns RestingOrder[]
     */
    bids() {
        return this.data.bids;
    }
    /**
     * Get all open asks on the market.
     *
     * @returns RestingOrder[]
     */
    asks() {
        return this.data.asks;
    }
    /**
     * Get all open orders on the market.
     *
     * @returns RestingOrder[]
     */
    openOrders() {
        return [...this.data.bids, ...this.data.asks];
    }
    /**
     * Print all information loaded about the market in a human readable format.
     */
    prettyPrint() {
        console.log('');
        console.log(`Market: ${this.address}`);
        console.log(`========================`);
        console.log(`Version: ${this.data.version}`);
        console.log(`BaseMint: ${this.data.baseMint.toBase58()}`);
        console.log(`QuoteMint: ${this.data.quoteMint.toBase58()}`);
        console.log(`OrderSequenceNumber: ${this.data.orderSequenceNumber}`);
        console.log(`NumBytesAllocated: ${this.data.numBytesAllocated}`);
        console.log('Bids:');
        this.data.bids.forEach((bid) => {
            console.log(`trader: ${bid.trader} numBaseTokens: ${bid.numBaseTokens} token price: ${bid.tokenPrice} lastValidSlot: ${bid.lastValidSlot} sequenceNumber: ${bid.sequenceNumber}`);
        });
        console.log('Asks:');
        this.data.asks.forEach((ask) => {
            console.log(`trader: ${ask.trader} numBaseTokens: ${ask.numBaseTokens} token price: ${ask.tokenPrice} lastValidSlot: ${ask.lastValidSlot} sequenceNumber: ${ask.sequenceNumber}`);
        });
        console.log('ClaimedSeats:');
        this.data.claimedSeats.forEach((claimedSeat) => {
            console.log(`publicKey: ${claimedSeat.publicKey.toBase58()} baseBalance: ${claimedSeat.baseBalance} quoteBalance: ${claimedSeat.quoteBalance}`);
        });
        console.log(`========================`);
    }
    /**
     * Deserializes market data from a given buffer and returns a `Market` object
     *
     * This includes both the fixed and dynamic parts of the market.
     * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/market.rs
     *
     * @param data The data buffer to deserialize
     */
    static deserializeMarketBuffer(data) {
        let offset = 0;
        // Deserialize the market header
        const _discriminant = data.readBigUInt64LE(0);
        offset += 8;
        const version = data.readUInt8(offset);
        offset += 1;
        const baseMintDecimals = data.readUInt8(offset);
        offset += 1;
        const quoteMintDecimals = data.readUInt8(offset);
        offset += 1;
        const _baseVaultBump = data.readUInt8(offset);
        offset += 1;
        const _quoteVaultBump = data.readUInt8(offset);
        offset += 1;
        // 3 bytes of unused padding.
        offset += 3;
        const baseMint = beet_solana_1.publicKey.read(data, offset);
        offset += beet_solana_1.publicKey.byteSize;
        const quoteMint = beet_solana_1.publicKey.read(data, offset);
        offset += beet_solana_1.publicKey.byteSize;
        const _baseVault = beet_solana_1.publicKey.read(data, offset);
        offset += beet_solana_1.publicKey.byteSize;
        const _quoteVault = beet_solana_1.publicKey.read(data, offset);
        offset += beet_solana_1.publicKey.byteSize;
        const orderSequenceNumber = data.readBigUInt64LE(offset);
        offset += 8;
        const numBytesAllocated = data.readUInt32LE(offset);
        offset += 4;
        const bidsRootIndex = data.readUInt32LE(offset);
        offset += 4;
        const _bidsBestIndex = data.readUInt32LE(offset);
        offset += 4;
        const asksRootIndex = data.readUInt32LE(offset);
        offset += 4;
        const _askBestIndex = data.readUInt32LE(offset);
        offset += 4;
        const claimedSeatsRootIndex = data.readUInt32LE(offset);
        offset += 4;
        const _freeListHeadIndex = data.readUInt32LE(offset);
        offset += 4;
        // _padding2: [u32; 3],
        // _padding3: [u64; 8],
        const bids = bidsRootIndex != constants_1.NIL
            ? (0, redBlackTree_1.deserializeRedBlackTree)(data.subarray(constants_1.FIXED_MANIFEST_HEADER_SIZE), bidsRootIndex, beet_1.restingOrderBeet).map((restingOrderInternal) => {
                return {
                    trader: beet_1.publicKeyBeet.deserialize(data.subarray(Number(restingOrderInternal.traderIndex) +
                        16 +
                        constants_1.FIXED_MANIFEST_HEADER_SIZE, Number(restingOrderInternal.traderIndex) +
                        48 +
                        constants_1.FIXED_MANIFEST_HEADER_SIZE))[0].publicKey,
                    numBaseTokens: (0, numbers_1.toNum)(restingOrderInternal.numBaseAtoms) /
                        10 ** baseMintDecimals,
                    tokenPrice: (0, numbers_1.convertU128)(restingOrderInternal.price) *
                        10 ** (baseMintDecimals - quoteMintDecimals),
                    ...restingOrderInternal,
                };
            })
            : [];
        const asks = asksRootIndex != constants_1.NIL
            ? (0, redBlackTree_1.deserializeRedBlackTree)(data.subarray(constants_1.FIXED_MANIFEST_HEADER_SIZE), asksRootIndex, beet_1.restingOrderBeet).map((restingOrderInternal) => {
                return {
                    trader: beet_1.publicKeyBeet.deserialize(data.subarray(Number(restingOrderInternal.traderIndex) +
                        16 +
                        constants_1.FIXED_MANIFEST_HEADER_SIZE, Number(restingOrderInternal.traderIndex) +
                        48 +
                        constants_1.FIXED_MANIFEST_HEADER_SIZE))[0].publicKey,
                    numBaseTokens: (0, numbers_1.toNum)(restingOrderInternal.numBaseAtoms) /
                        10 ** baseMintDecimals,
                    tokenPrice: (0, numbers_1.convertU128)(restingOrderInternal.price) *
                        10 ** (baseMintDecimals - quoteMintDecimals),
                    ...restingOrderInternal,
                };
            })
            : [];
        const claimedSeats = claimedSeatsRootIndex != constants_1.NIL
            ? (0, redBlackTree_1.deserializeRedBlackTree)(data.subarray(constants_1.FIXED_MANIFEST_HEADER_SIZE), claimedSeatsRootIndex, beet_1.claimedSeatBeet)
            : [];
        return {
            version,
            baseMintDecimals,
            quoteMintDecimals,
            baseMint,
            quoteMint,
            orderSequenceNumber,
            numBytesAllocated,
            bids,
            asks,
            claimedSeats,
        };
    }
}
exports.Market = Market;
