"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UiWrapper = void 0;
const beet_solana_1 = require("@metaplex-foundation/beet-solana");
const ui_wrapper_1 = require("./ui_wrapper");
const beet_1 = require("./utils/beet");
const redBlackTree_1 = require("./utils/redBlackTree");
const constants_1 = require("./constants");
const manifest_1 = require("./manifest");
const market_1 = require("./utils/market");
const spl_token_1 = require("@solana/spl-token");
const numbers_1 = require("./utils/numbers");
const bn_js_1 = require("bn.js");
/**
 * Wrapper object used for reading data from a wrapper for manifest markets.
 */
class UiWrapper {
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
        const wrapperData = UiWrapper.deserializeWrapperBuffer(buffer);
        return new UiWrapper({ address, data: wrapperData });
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
        this.data = UiWrapper.deserializeWrapperBuffer(buffer);
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
        console.log(`Owner: ${this.data.owner.toBase58()}`);
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
        const owner = beet_solana_1.publicKey.read(data, offset);
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
                    price: (0, numbers_1.convertU128)(new bn_js_1.BN(openOrder.price, 10, 'le')),
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
            owner,
            marketInfos: parsedMarketInfos,
        };
    }
    placeOrderIx(market, accounts, args) {
        const { owner } = this.data;
        const payer = accounts.payer ?? owner;
        const { isBid } = args;
        const mint = isBid ? market.quoteMint() : market.baseMint();
        const traderTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, owner);
        const vault = (0, market_1.getVaultAddress)(market.address, mint);
        const clientOrderId = args.orderId ?? Date.now();
        const baseAtoms = Math.round(args.amount * 10 ** market.baseDecimals());
        let priceMantissa = args.price;
        let priceExponent = market.baseDecimals() - market.quoteDecimals();
        while (priceMantissa < constants_1.U32_MAX / 10 &&
            priceExponent > constants_1.PRICE_MIN_EXP &&
            Math.round(priceMantissa) != priceMantissa) {
            priceMantissa *= 10;
            priceExponent -= 1;
        }
        while (priceMantissa > constants_1.U32_MAX && priceExponent < constants_1.PRICE_MAX_EXP) {
            priceMantissa = priceMantissa / 10;
            priceExponent += 1;
        }
        priceMantissa = Math.round(priceMantissa);
        return (0, ui_wrapper_1.createPlaceOrderInstruction)({
            wrapperState: this.address,
            owner,
            traderTokenAccount,
            market: market.address,
            vault,
            mint,
            manifestProgram: manifest_1.PROGRAM_ID,
            payer,
        }, {
            params: {
                clientOrderId,
                baseAtoms,
                priceMantissa,
                priceExponent,
                isBid,
                lastValidSlot: constants_1.NO_EXPIRATION_LAST_VALID_SLOT,
                orderType: ui_wrapper_1.OrderType.Limit,
            },
        });
    }
}
exports.UiWrapper = UiWrapper;
