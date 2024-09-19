import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { createPlaceOrderInstruction, OrderType } from './ui_wrapper';
import { marketInfoBeet, openOrderBeet } from './utils/beet';
import { deserializeRedBlackTree } from './utils/redBlackTree';
import { FIXED_WRAPPER_HEADER_SIZE, NIL, NO_EXPIRATION_LAST_VALID_SLOT, PRICE_MAX_EXP, PRICE_MIN_EXP, U32_MAX, } from './constants';
import { PROGRAM_ID as MANIFEST_PROGRAM_ID } from './manifest';
import { getVaultAddress } from './utils/market';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { convertU128 } from './utils/numbers';
import { BN } from 'bn.js';
/**
 * Wrapper object used for reading data from a wrapper for manifest markets.
 */
export class UiWrapper {
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
    activeMarkets() {
        return this.data.marketInfos.map((mi) => mi.market);
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
        const owner = beetPublicKey.read(data, offset);
        offset += beetPublicKey.byteSize;
        const _numBytesAllocated = data.readUInt32LE(offset);
        offset += 4;
        const _freeListHeadIndex = data.readUInt32LE(offset);
        offset += 4;
        const marketInfosRootIndex = data.readUInt32LE(offset);
        offset += 4;
        const _padding = data.readUInt32LE(offset);
        offset += 12;
        const marketInfos = marketInfosRootIndex != NIL
            ? deserializeRedBlackTree(data.subarray(FIXED_WRAPPER_HEADER_SIZE), marketInfosRootIndex, marketInfoBeet)
            : [];
        const parsedMarketInfos = marketInfos.map((marketInfoRaw) => {
            const rootIndex = marketInfoRaw.openOrdersRootIndex;
            const parsedOpenOrders = rootIndex != NIL
                ? deserializeRedBlackTree(data.subarray(FIXED_WRAPPER_HEADER_SIZE), rootIndex, openOrderBeet)
                : [];
            const parsedOpenOrdersWithPrice = parsedOpenOrders.map((openOrder) => {
                return {
                    ...openOrder,
                    price: convertU128(new BN(openOrder.price, 10, 'le')),
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
        const traderTokenAccount = getAssociatedTokenAddressSync(mint, owner);
        const vault = getVaultAddress(market.address, mint);
        const clientOrderId = args.orderId ?? Date.now();
        const baseAtoms = Math.round(args.amount * 10 ** market.baseDecimals());
        let priceMantissa = args.price;
        let priceExponent = market.quoteDecimals() - market.baseDecimals();
        while (priceMantissa < U32_MAX / 10 &&
            priceExponent > PRICE_MIN_EXP &&
            Math.round(priceMantissa) != priceMantissa) {
            priceMantissa *= 10;
            priceExponent -= 1;
        }
        while (priceMantissa > U32_MAX && priceExponent < PRICE_MAX_EXP) {
            priceMantissa = priceMantissa / 10;
            priceExponent += 1;
        }
        priceMantissa = Math.round(priceMantissa);
        return createPlaceOrderInstruction({
            wrapperState: this.address,
            owner,
            traderTokenAccount,
            market: market.address,
            vault,
            mint,
            manifestProgram: MANIFEST_PROGRAM_ID,
            payer,
        }, {
            params: {
                clientOrderId,
                baseAtoms,
                priceMantissa,
                priceExponent,
                isBid,
                lastValidSlot: NO_EXPIRATION_LAST_VALID_SLOT,
                orderType: OrderType.Limit,
            },
        });
    }
}
