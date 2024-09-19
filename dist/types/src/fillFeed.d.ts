import { Connection } from '@solana/web3.js';
/**
 * FillFeed example implementation.
 */
export declare class FillFeed {
    private connection;
    private wss;
    constructor(connection: Connection);
    /**
     * Parse logs in an endless loop.
     */
    parseLogs(endEarly?: boolean): Promise<void>;
    /**
     * Handle a signature by fetching the tx onchain and possibly sending a fill
     * notification.
     */
    private handleSignature;
}
/**
 * Run a fill feed as a websocket server that clients can connect to and get
 * notifications of fills for all manifest markets.
 */
export declare function runFillFeed(): Promise<void>;
/**
 * FillLogResult is the message sent to subscribers of the FillFeed
 */
export type FillLogResult = {
    /** Public key for the market as base58. */
    market: string;
    /** Public key for the maker as base58. */
    maker: string;
    /** Public key for the taker as base58. */
    taker: string;
    /** Number of base atoms traded. */
    baseAtoms: number;
    /** Number of quote atoms traded. */
    quoteAtoms: number;
    /** Price as float. Quote atoms per base atom. */
    price: number;
    /** Boolean to indicate which side the trade was. */
    takerIsBuy: boolean;
    /** Slot number of the fill. */
    slot: number;
};
//# sourceMappingURL=fillFeed.d.ts.map