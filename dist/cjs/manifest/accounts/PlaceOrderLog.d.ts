/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
import * as web3 from '@solana/web3.js';
import * as beet from '@metaplex-foundation/beet';
import * as beetSolana from '@metaplex-foundation/beet-solana';
import { QuoteAtomsPerBaseAtom } from './QuoteAtomsPerBaseAtom';
import { BaseAtoms } from './BaseAtoms';
import { OrderType } from '../types/OrderType';
/**
 * Arguments used to create {@link PlaceOrderLog}
 * @category Accounts
 * @category generated
 */
export type PlaceOrderLogArgs = {
    market: web3.PublicKey;
    trader: web3.PublicKey;
    price: QuoteAtomsPerBaseAtom;
    baseAtoms: BaseAtoms;
    orderSequenceNumber: beet.bignum;
    orderIndex: number;
    lastValidSlot: number;
    orderType: OrderType;
    isBid: boolean;
    padding: number[];
};
/**
 * Holds the data for the {@link PlaceOrderLog} Account and provides de/serialization
 * functionality for that data
 *
 * @category Accounts
 * @category generated
 */
export declare class PlaceOrderLog implements PlaceOrderLogArgs {
    readonly market: web3.PublicKey;
    readonly trader: web3.PublicKey;
    readonly price: QuoteAtomsPerBaseAtom;
    readonly baseAtoms: BaseAtoms;
    readonly orderSequenceNumber: beet.bignum;
    readonly orderIndex: number;
    readonly lastValidSlot: number;
    readonly orderType: OrderType;
    readonly isBid: boolean;
    readonly padding: number[];
    private constructor();
    /**
     * Creates a {@link PlaceOrderLog} instance from the provided args.
     */
    static fromArgs(args: PlaceOrderLogArgs): PlaceOrderLog;
    /**
     * Deserializes the {@link PlaceOrderLog} from the data of the provided {@link web3.AccountInfo}.
     * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
     */
    static fromAccountInfo(accountInfo: web3.AccountInfo<Buffer>, offset?: number): [PlaceOrderLog, number];
    /**
     * Retrieves the account info from the provided address and deserializes
     * the {@link PlaceOrderLog} from its data.
     *
     * @throws Error if no account info is found at the address or if deserialization fails
     */
    static fromAccountAddress(connection: web3.Connection, address: web3.PublicKey, commitmentOrConfig?: web3.Commitment | web3.GetAccountInfoConfig): Promise<PlaceOrderLog>;
    /**
     * Provides a {@link web3.Connection.getProgramAccounts} config builder,
     * to fetch accounts matching filters that can be specified via that builder.
     *
     * @param programId - the program that owns the accounts we are filtering
     */
    static gpaBuilder(programId?: web3.PublicKey): beetSolana.GpaBuilder<{
        orderSequenceNumber: any;
        baseAtoms: any;
        isBid: any;
        lastValidSlot: any;
        orderType: any;
        market: any;
        trader: any;
        price: any;
        padding: any;
        orderIndex: any;
    }>;
    /**
     * Deserializes the {@link PlaceOrderLog} from the provided data Buffer.
     * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
     */
    static deserialize(buf: Buffer, offset?: number): [PlaceOrderLog, number];
    /**
     * Serializes the {@link PlaceOrderLog} into a Buffer.
     * @returns a tuple of the created Buffer and the offset up to which the buffer was written to store it.
     */
    serialize(): [Buffer, number];
    /**
     * Returns the byteSize of a {@link Buffer} holding the serialized data of
     * {@link PlaceOrderLog}
     */
    static get byteSize(): number;
    /**
     * Fetches the minimum balance needed to exempt an account holding
     * {@link PlaceOrderLog} data from rent
     *
     * @param connection used to retrieve the rent exemption information
     */
    static getMinimumBalanceForRentExemption(connection: web3.Connection, commitment?: web3.Commitment): Promise<number>;
    /**
     * Determines if the provided {@link Buffer} has the correct byte size to
     * hold {@link PlaceOrderLog} data.
     */
    static hasCorrectByteSize(buf: Buffer, offset?: number): boolean;
    /**
     * Returns a readable version of {@link PlaceOrderLog} properties
     * and can be used to convert to JSON and/or logging
     */
    pretty(): {
        market: string;
        trader: string;
        price: QuoteAtomsPerBaseAtom;
        baseAtoms: BaseAtoms;
        orderSequenceNumber: number | {
            toNumber: () => number;
        };
        orderIndex: number;
        lastValidSlot: number;
        orderType: string;
        isBid: boolean;
        padding: number[];
    };
}
/**
 * @category Accounts
 * @category generated
 */
export declare const placeOrderLogBeet: beet.BeetStruct<PlaceOrderLog, PlaceOrderLogArgs>;
