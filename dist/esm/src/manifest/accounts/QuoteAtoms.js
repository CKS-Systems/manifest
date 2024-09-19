/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
import * as beet from '@metaplex-foundation/beet';
import * as web3 from '@solana/web3.js';
import * as beetSolana from '@metaplex-foundation/beet-solana';
/**
 * Holds the data for the {@link QuoteAtoms} Account and provides de/serialization
 * functionality for that data
 *
 * @category Accounts
 * @category generated
 */
export class QuoteAtoms {
    inner;
    constructor(inner) {
        this.inner = inner;
    }
    /**
     * Creates a {@link QuoteAtoms} instance from the provided args.
     */
    static fromArgs(args) {
        return new QuoteAtoms(args.inner);
    }
    /**
     * Deserializes the {@link QuoteAtoms} from the data of the provided {@link web3.AccountInfo}.
     * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
     */
    static fromAccountInfo(accountInfo, offset = 0) {
        return QuoteAtoms.deserialize(accountInfo.data, offset);
    }
    /**
     * Retrieves the account info from the provided address and deserializes
     * the {@link QuoteAtoms} from its data.
     *
     * @throws Error if no account info is found at the address or if deserialization fails
     */
    static async fromAccountAddress(connection, address, commitmentOrConfig) {
        const accountInfo = await connection.getAccountInfo(address, commitmentOrConfig);
        if (accountInfo == null) {
            throw new Error(`Unable to find QuoteAtoms account at ${address}`);
        }
        return QuoteAtoms.fromAccountInfo(accountInfo, 0)[0];
    }
    /**
     * Provides a {@link web3.Connection.getProgramAccounts} config builder,
     * to fetch accounts matching filters that can be specified via that builder.
     *
     * @param programId - the program that owns the accounts we are filtering
     */
    static gpaBuilder(programId = new web3.PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms')) {
        return beetSolana.GpaBuilder.fromStruct(programId, quoteAtomsBeet);
    }
    /**
     * Deserializes the {@link QuoteAtoms} from the provided data Buffer.
     * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
     */
    static deserialize(buf, offset = 0) {
        return quoteAtomsBeet.deserialize(buf, offset);
    }
    /**
     * Serializes the {@link QuoteAtoms} into a Buffer.
     * @returns a tuple of the created Buffer and the offset up to which the buffer was written to store it.
     */
    serialize() {
        return quoteAtomsBeet.serialize(this);
    }
    /**
     * Returns the byteSize of a {@link Buffer} holding the serialized data of
     * {@link QuoteAtoms}
     */
    static get byteSize() {
        return quoteAtomsBeet.byteSize;
    }
    /**
     * Fetches the minimum balance needed to exempt an account holding
     * {@link QuoteAtoms} data from rent
     *
     * @param connection used to retrieve the rent exemption information
     */
    static async getMinimumBalanceForRentExemption(connection, commitment) {
        return connection.getMinimumBalanceForRentExemption(QuoteAtoms.byteSize, commitment);
    }
    /**
     * Determines if the provided {@link Buffer} has the correct byte size to
     * hold {@link QuoteAtoms} data.
     */
    static hasCorrectByteSize(buf, offset = 0) {
        return buf.byteLength - offset === QuoteAtoms.byteSize;
    }
    /**
     * Returns a readable version of {@link QuoteAtoms} properties
     * and can be used to convert to JSON and/or logging
     */
    pretty() {
        return {
            inner: (() => {
                const x = this.inner;
                if (typeof x.toNumber === 'function') {
                    try {
                        return x.toNumber();
                    }
                    catch (_) {
                        return x;
                    }
                }
                return x;
            })(),
        };
    }
}
/**
 * @category Accounts
 * @category generated
 */
export const quoteAtomsBeet = new beet.BeetStruct([['inner', beet.u64]], QuoteAtoms.fromArgs, 'QuoteAtoms');
