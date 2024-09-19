import { claimedSeatBeet, publicKeyBeet, restingOrderBeet } from './utils/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { deserializeRedBlackTree } from './utils/redBlackTree';
import { convertU128, toNum } from './utils/numbers';
import { FIXED_MANIFEST_HEADER_SIZE, NIL } from './constants';
import { PROGRAM_ID } from './manifest';
/**
 * Market object used for reading data from a manifest market.
 */
export class Market {
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
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
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
            ? toNum(seat.baseBalance) / 10 ** this.baseDecimals()
            : toNum(seat.quoteBalance) / 10 ** this.quoteDecimals();
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
        const baseMint = beetPublicKey.read(data, offset);
        offset += beetPublicKey.byteSize;
        const quoteMint = beetPublicKey.read(data, offset);
        offset += beetPublicKey.byteSize;
        const _baseVault = beetPublicKey.read(data, offset);
        offset += beetPublicKey.byteSize;
        const _quoteVault = beetPublicKey.read(data, offset);
        offset += beetPublicKey.byteSize;
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
        const bids = bidsRootIndex != NIL
            ? deserializeRedBlackTree(data.subarray(FIXED_MANIFEST_HEADER_SIZE), bidsRootIndex, restingOrderBeet).map((restingOrderInternal) => {
                return {
                    trader: publicKeyBeet.deserialize(data.subarray(Number(restingOrderInternal.traderIndex) +
                        16 +
                        FIXED_MANIFEST_HEADER_SIZE, Number(restingOrderInternal.traderIndex) +
                        48 +
                        FIXED_MANIFEST_HEADER_SIZE))[0].publicKey,
                    numBaseTokens: toNum(restingOrderInternal.numBaseAtoms) /
                        10 ** baseMintDecimals,
                    tokenPrice: convertU128(restingOrderInternal.price) *
                        10 ** (baseMintDecimals - quoteMintDecimals),
                    ...restingOrderInternal,
                };
            })
            : [];
        const asks = asksRootIndex != NIL
            ? deserializeRedBlackTree(data.subarray(FIXED_MANIFEST_HEADER_SIZE), asksRootIndex, restingOrderBeet).map((restingOrderInternal) => {
                return {
                    trader: publicKeyBeet.deserialize(data.subarray(Number(restingOrderInternal.traderIndex) +
                        16 +
                        FIXED_MANIFEST_HEADER_SIZE, Number(restingOrderInternal.traderIndex) +
                        48 +
                        FIXED_MANIFEST_HEADER_SIZE))[0].publicKey,
                    numBaseTokens: toNum(restingOrderInternal.numBaseAtoms) /
                        10 ** baseMintDecimals,
                    tokenPrice: convertU128(restingOrderInternal.price) *
                        10 ** (baseMintDecimals - quoteMintDecimals),
                    ...restingOrderInternal,
                };
            })
            : [];
        const claimedSeats = claimedSeatsRootIndex != NIL
            ? deserializeRedBlackTree(data.subarray(FIXED_MANIFEST_HEADER_SIZE), claimedSeatsRootIndex, claimedSeatBeet)
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
