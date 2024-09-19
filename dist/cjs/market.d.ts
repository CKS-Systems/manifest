import { PublicKey, Connection, GetProgramAccountsResponse } from '@solana/web3.js';
import { bignum } from '@metaplex-foundation/beet';
/**
 * Internal use only. Needed because shank doesnt handle f64 and because the
 * client doesnt need to know about padding.
 */
export type RestingOrderInternal = {
    traderIndex: bignum;
    numBaseAtoms: bignum;
    lastValidSlot: bignum;
    sequenceNumber: bignum;
    price: bignum;
    effectivePrice: bignum;
    padding: bignum[];
};
/**
 * RestingOrder on the market.
 */
export type RestingOrder = {
    /** Trader public key. */
    trader: PublicKey;
    /** Number of base tokens remaining in the order. */
    numBaseTokens: bignum;
    /** Last slot before this order is invalid and will be removed. */
    lastValidSlot: bignum;
    /** Exchange defined sequenceNumber for this order, guaranteed to be unique. */
    sequenceNumber: bignum;
    /** Price as float in tokens of quote per tokens of base. */
    tokenPrice: number;
};
/**
 * ClaimedSeat on the market.
 */
export type ClaimedSeat = {
    /** Public key of the trader. */
    publicKey: PublicKey;
    /** Balance of base atoms that are withdrawable (excluding in open orders). */
    baseBalance: bignum;
    /** Balance of quote atoms that are withdrawable (excluding in open orders). */
    quoteBalance: bignum;
};
/**
 * MarketData is all information stored on a market account.
 */
export interface MarketData {
    /** Version of the struct, included in case features are added later which use the padding. */
    version: number;
    /** Number of decimals for the baseMint (i.e. baseMintDecimals = 6 -> 1 baseAtom = .000001 baseToken). */
    baseMintDecimals: number;
    /** Number of decimals for the quoteMint (i.e. quoteMintDecimals = 6 -> 1 quoteAtom = .000001 quoteToken). */
    quoteMintDecimals: number;
    /** Public key for the base mint. */
    baseMint: PublicKey;
    /** Public key for the quote mint. */
    quoteMint: PublicKey;
    /** Current next order sequence number. */
    orderSequenceNumber: bigint;
    /** Number of bytes used in the dynamic portion of the market account. */
    numBytesAllocated: number;
    /** Sorted array of resting orders for bids currently on the orderbook. */
    bids: RestingOrder[];
    /** Sorted array of resting orders for asks currently on the orderbook. */
    asks: RestingOrder[];
    /** Array of all claimed seats. */
    claimedSeats: ClaimedSeat[];
}
/**
 * Market object used for reading data from a manifest market.
 */
export declare class Market {
    /** Public key for the market account. */
    address: PublicKey;
    /** Deserialized data. */
    private data;
    /**
     * Constructs a Market object.
     *
     * @param address The `PublicKey` of the market account
     * @param data Deserialized market data
     */
    private constructor();
    /**
     * Returns a `Market` for a given address, a data buffer
     *
     * @param marketAddress The `PublicKey` of the market account
     * @param buffer The buffer holding the market account data
     */
    static loadFromBuffer({ address, buffer, }: {
        address: PublicKey;
        buffer: Buffer;
    }): Market;
    /**
     * Returns a `Market` for a given address, a data buffer
     *
     * @param connection The Solana `Connection` object
     * @param address The `PublicKey` of the market account
     */
    static loadFromAddress({ connection, address, }: {
        connection: Connection;
        address: PublicKey;
    }): Promise<Market>;
    /**
     * Updates the data in a Market.
     *
     * @param connection The Solana `Connection` object
     */
    reload(connection: Connection): Promise<void>;
    static findMarkets(connection: Connection, baseMint: PublicKey, quoteMint: PublicKey): Promise<GetProgramAccountsResponse>;
    /**
     * Get the amount in tokens of balance that is deposited on this market, does
     * not include tokens currently in open orders.
     *
     * @param trader PublicKey of the trader to check balance of
     * @param isBase boolean for whether this is checking base or quote
     *
     * @returns number in tokens
     */
    getWithdrawableBalanceTokens(trader: PublicKey, isBase: boolean): number;
    /**
     * Gets the base mint of the market
     *
     * @returns PublicKey
     */
    baseMint(): PublicKey;
    /**
     * Gets the quote mint of the market
     *
     * @returns PublicKey
     */
    quoteMint(): PublicKey;
    /**
     * Gets the base decimals of the market
     *
     * @returns number
     */
    baseDecimals(): number;
    /**
     * Gets the base decimals of the market
     *
     * @returns number
     */
    quoteDecimals(): number;
    /**
     * Check whether a given public key has a claimed seat on the market
     *
     * @param trader PublicKey of the trader
     *
     * @returns boolean
     */
    hasSeat(trader: PublicKey): boolean;
    /**
     * Get all open bids on the market.
     *
     * @returns RestingOrder[]
     */
    bids(): RestingOrder[];
    /**
     * Get all open asks on the market.
     *
     * @returns RestingOrder[]
     */
    asks(): RestingOrder[];
    /**
     * Get all open orders on the market.
     *
     * @returns RestingOrder[]
     */
    openOrders(): RestingOrder[];
    /**
     * Print all information loaded about the market in a human readable format.
     */
    prettyPrint(): void;
    /**
     * Deserializes market data from a given buffer and returns a `Market` object
     *
     * This includes both the fixed and dynamic parts of the market.
     * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/market.rs
     *
     * @param data The data buffer to deserialize
     */
    static deserializeMarketBuffer(data: Buffer): MarketData;
}
