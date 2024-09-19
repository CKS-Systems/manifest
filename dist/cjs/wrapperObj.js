"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Wrapper = void 0;
const beet_solana_1 = require("@metaplex-foundation/beet-solana");
const beet_1 = require("./utils/beet");
const constants_1 = require("./constants");
const redBlackTree_1 = require("./utils/redBlackTree");
/**
 * Wrapper object used for reading data from a wrapper for manifest markets.
 */
class Wrapper {
    /** Public key for the market account. */
    address;
    /** Deserialized data. */
    data;
    /**
     * Constructs a Wrapper object.
     *
     * @param address The `PublicKey` of the wrapper account
     * @param data Deserialized wrapper data
     */
    constructor({ address, data, }) {
        this.address = address;
        this.data = data;
    }
    /**
     * Returns a `Wrapper` for a given address, a data buffer
     *
     * @param marketAddress The `PublicKey` of the wrapper account
     * @param buffer The buffer holding the wrapper account data
     */
    static loadFromBuffer({ address, buffer, }) {
        const wrapperData = Wrapper.deserializeWrapperBuffer(buffer);
        return new Wrapper({ address, data: wrapperData });
    }
    /**
     * Returns a `Wrapper` for a given address, a data buffer
     *
     * @param connection The Solana `Connection` object
     * @param address The `PublicKey` of the wrapper account
     */
    static async loadFromAddress({ connection, address, }) {
        const buffer = await connection
            .getAccountInfo(address)
            .then((accountInfo) => accountInfo?.data);
        if (buffer === undefined) {
            throw new Error(`Failed to load ${address}`);
        }
        return Wrapper.loadFromBuffer({ address, buffer });
    }
    /**
     * Updates the data in a Wrapper.
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
        this.data = Wrapper.deserializeWrapperBuffer(buffer);
    }
    /**
     * Get the parsed market info from the wrapper.
     *
     * @param marketPk PublicKey for the market
     *
     * @return MarketInfoParsed
     */
    marketInfoForMarket(marketPk) {
        const filtered = this.data.marketInfos.filter((marketInfo) => {
            return marketInfo.market.toBase58() == marketPk.toBase58();
        });
        if (filtered.length == 0) {
            return null;
        }
        return filtered[0];
    }
    /**
     * Get the open orders from the wrapper.
     *
     * @param marketPk PublicKey for the market
     *
     * @return OpenOrder[]
     */
    openOrdersForMarket(marketPk) {
        const filtered = this.data.marketInfos.filter((marketInfo) => {
            return marketInfo.market.toBase58() == marketPk.toBase58();
        });
        if (filtered.length == 0) {
            return null;
        }
        return filtered[0].orders;
    }
    // Do not include getters for the balances because those can be retrieved from
    // the market and that will be fresher data or the same always.
    /**
     * Print all information loaded about the wrapper in a human readable format.
     */
    prettyPrint() {
        console.log('');
        console.log(`Wrapper: ${this.address.toBase58()}`);
        console.log(`========================`);
        console.log(`Trader: ${this.data.trader.toBase58()}`);
        this.data.marketInfos.forEach((marketInfo) => {
            console.log(`------------------------`);
            console.log(`Market: ${marketInfo.market}`);
            console.log(`Last updated slot: ${marketInfo.lastUpdatedSlot}`);
            console.log(`BaseAtoms: ${marketInfo.baseBalanceAtoms} QuoteAtoms: ${marketInfo.quoteBalanceAtoms}`);
            marketInfo.orders.forEach((order) => {
                console.log(`OpenOrder: ClientOrderId: ${order.clientOrderId} ${order.numBaseAtoms}@${order.price} SeqNum: ${order.orderSequenceNumber} LastValidSlot: ${order.lastValidSlot} IsBid: ${order.isBid}`);
            });
        });
        console.log(`------------------------`);
    }
    /**
     * Deserializes wrapper data from a given buffer and returns a `Wrapper` object
     *
     * This includes both the fixed and dynamic parts of the market.
     * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/wrapper_state.rs
     *
     * @param data The data buffer to deserialize
     *
     * @returns WrapperData
     */
    static deserializeWrapperBuffer(data) {
        let offset = 0;
        // Deserialize the market header
        const _discriminant = data.readBigUInt64LE(0);
        offset += 8;
        const trader = beet_solana_1.publicKey.read(data, offset);
        offset += beet_solana_1.publicKey.byteSize;
        const _numBytesAllocated = data.readUInt32LE(offset);
        offset += 4;
        const _freeListHeadIndex = data.readUInt32LE(offset);
        offset += 4;
        const marketInfosRootIndex = data.readUInt32LE(offset);
        offset += 4;
        const _padding = data.readUInt32LE(offset);
        offset += 12;
        const marketInfos = marketInfosRootIndex != constants_1.NIL
            ? (0, redBlackTree_1.deserializeRedBlackTree)(data.subarray(constants_1.FIXED_WRAPPER_HEADER_SIZE), marketInfosRootIndex, beet_1.marketInfoBeet)
            : [];
        const parsedMarketInfos = marketInfos.map((marketInfoRaw) => {
            const rootIndex = marketInfoRaw.openOrdersRootIndex;
            const parsedOpenOrders = rootIndex != constants_1.NIL
                ? (0, redBlackTree_1.deserializeRedBlackTree)(data.subarray(constants_1.FIXED_WRAPPER_HEADER_SIZE), rootIndex, beet_1.openOrderBeet)
                : [];
            const parsedOpenOrdersWithPrice = parsedOpenOrders.map((openOrder) => {
                return {
                    ...openOrder,
                    price: 0,
                };
            });
            return {
                market: marketInfoRaw.market,
                baseBalanceAtoms: marketInfoRaw.baseBalanceAtoms,
                quoteBalanceAtoms: marketInfoRaw.quoteBalanceAtoms,
                orders: parsedOpenOrdersWithPrice,
                lastUpdatedSlot: marketInfoRaw.lastUpdatedSlot,
            };
        });
        return {
            trader,
            marketInfos: parsedMarketInfos,
        };
    }
}
exports.Wrapper = Wrapper;
