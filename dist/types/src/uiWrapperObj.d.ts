import { bignum } from '@metaplex-foundation/beet';
import { Connection, PublicKey } from '@solana/web3.js';
import { OrderType } from './ui_wrapper';
import { Market } from './market';
/**
 * All data stored on a wrapper account.
 */
export interface WrapperData {
    /** Public key for the owner of this wrapper. */
    owner: PublicKey;
    /** Array of market infos that have been parsed. */
    marketInfos: MarketInfoParsed[];
}
/**
 * Parsed market info on a wrapper. Accurate to the last sync.
 */
export interface MarketInfoParsed {
    /** Public key for market. */
    market: PublicKey;
    /** Base balance in atoms. */
    baseBalanceAtoms: bignum;
    /** Quote balance in atoms. */
    quoteBalanceAtoms: bignum;
    /** Open orders. */
    orders: OpenOrder[];
    /** Last update slot number. */
    lastUpdatedSlot: number;
}
/**
 * Raw market info on a wrapper.
 */
export interface MarketInfoRaw {
    market: PublicKey;
    openOrdersRootIndex: number;
    traderIndex: number;
    baseBalanceAtoms: bignum;
    quoteBalanceAtoms: bignum;
    quoteVolumeAtoms: bignum;
    lastUpdatedSlot: number;
    padding: number;
}
/**
 * OpenOrder on a wrapper. Accurate as of the latest sync.
 */
export interface OpenOrder {
    /** Client order id used for cancelling orders. Does not need to be unique. */
    clientOrderId: bignum;
    /** Exchange defined id for an order. */
    orderSequenceNumber: bignum;
    /** Price as float in atoms of quote per atoms of base. */
    price: number;
    /** Number of base atoms in the order. */
    numBaseAtoms: bignum;
    /** Hint for the location of the order in the manifest dynamic data. */
    dataIndex: number;
    /** Last slot before this order is invalid and will be removed. */
    lastValidSlot: number;
    /** Boolean for whether this order is on the bid side. */
    isBid: boolean;
    /** Type of order (Limit, PostOnly, ...). */
    orderType: OrderType;
}
export interface OpenOrderInternal {
    price: Uint8Array;
    clientOrderId: bignum;
    orderSequenceNumber: bignum;
    numBaseAtoms: bignum;
    dataIndex: number;
    lastValidSlot: number;
    isBid: boolean;
    orderType: number;
    padding: bignum[];
}
/**
 * Wrapper object used for reading data from a wrapper for manifest markets.
 */
export declare class UiWrapper {
    /** Public key for the market account. */
    address: PublicKey;
    /** Deserialized data. */
    private data;
    /**
     * Constructs a Wrapper object.
     *
     * @param address The `PublicKey` of the wrapper account
     * @param data Deserialized wrapper data
     */
    private constructor();
    /**
     * Returns a `Wrapper` for a given address, a data buffer
     *
     * @param marketAddress The `PublicKey` of the wrapper account
     * @param buffer The buffer holding the wrapper account data
     */
    static loadFromBuffer({ address, buffer, }: {
        address: PublicKey;
        buffer: Buffer;
    }): UiWrapper;
    /**
     * Updates the data in a Wrapper.
     *
     * @param connection The Solana `Connection` object
     */
    reload(connection: Connection): Promise<void>;
    /**
     * Get the parsed market info from the wrapper.
     *
     * @param marketPk PublicKey for the market
     *
     * @return MarketInfoParsed
     */
    marketInfoForMarket(marketPk: PublicKey): MarketInfoParsed | null;
    /**
     * Get the open orders from the wrapper.
     *
     * @param marketPk PublicKey for the market
     *
     * @return OpenOrder[]
     */
    openOrdersForMarket(marketPk: PublicKey): OpenOrder[] | null;
    activeMarkets(): PublicKey[];
    /**
     * Print all information loaded about the wrapper in a human readable format.
     */
    prettyPrint(): void;
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
    static deserializeWrapperBuffer(data: Buffer): WrapperData;
    placeOrderIx(market: Market, accounts: {
        payer?: PublicKey;
    }, args: {
        isBid: boolean;
        amount: number;
        price: number;
        orderId?: number;
    }): import("@solana/web3.js").TransactionInstruction;
}
//# sourceMappingURL=uiWrapperObj.d.ts.map