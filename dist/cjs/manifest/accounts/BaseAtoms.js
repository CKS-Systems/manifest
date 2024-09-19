"use strict";
/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseAtomsBeet = exports.BaseAtoms = void 0;
const beet = __importStar(require("@metaplex-foundation/beet"));
const web3 = __importStar(require("@solana/web3.js"));
const beetSolana = __importStar(require("@metaplex-foundation/beet-solana"));
/**
 * Holds the data for the {@link BaseAtoms} Account and provides de/serialization
 * functionality for that data
 *
 * @category Accounts
 * @category generated
 */
class BaseAtoms {
    inner;
    constructor(inner) {
        this.inner = inner;
    }
    /**
     * Creates a {@link BaseAtoms} instance from the provided args.
     */
    static fromArgs(args) {
        return new BaseAtoms(args.inner);
    }
    /**
     * Deserializes the {@link BaseAtoms} from the data of the provided {@link web3.AccountInfo}.
     * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
     */
    static fromAccountInfo(accountInfo, offset = 0) {
        return BaseAtoms.deserialize(accountInfo.data, offset);
    }
    /**
     * Retrieves the account info from the provided address and deserializes
     * the {@link BaseAtoms} from its data.
     *
     * @throws Error if no account info is found at the address or if deserialization fails
     */
    static async fromAccountAddress(connection, address, commitmentOrConfig) {
        const accountInfo = await connection.getAccountInfo(address, commitmentOrConfig);
        if (accountInfo == null) {
            throw new Error(`Unable to find BaseAtoms account at ${address}`);
        }
        return BaseAtoms.fromAccountInfo(accountInfo, 0)[0];
    }
    /**
     * Provides a {@link web3.Connection.getProgramAccounts} config builder,
     * to fetch accounts matching filters that can be specified via that builder.
     *
     * @param programId - the program that owns the accounts we are filtering
     */
    static gpaBuilder(programId = new web3.PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms')) {
        return beetSolana.GpaBuilder.fromStruct(programId, exports.baseAtomsBeet);
    }
    /**
     * Deserializes the {@link BaseAtoms} from the provided data Buffer.
     * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
     */
    static deserialize(buf, offset = 0) {
        return exports.baseAtomsBeet.deserialize(buf, offset);
    }
    /**
     * Serializes the {@link BaseAtoms} into a Buffer.
     * @returns a tuple of the created Buffer and the offset up to which the buffer was written to store it.
     */
    serialize() {
        return exports.baseAtomsBeet.serialize(this);
    }
    /**
     * Returns the byteSize of a {@link Buffer} holding the serialized data of
     * {@link BaseAtoms}
     */
    static get byteSize() {
        return exports.baseAtomsBeet.byteSize;
    }
    /**
     * Fetches the minimum balance needed to exempt an account holding
     * {@link BaseAtoms} data from rent
     *
     * @param connection used to retrieve the rent exemption information
     */
    static async getMinimumBalanceForRentExemption(connection, commitment) {
        return connection.getMinimumBalanceForRentExemption(BaseAtoms.byteSize, commitment);
    }
    /**
     * Determines if the provided {@link Buffer} has the correct byte size to
     * hold {@link BaseAtoms} data.
     */
    static hasCorrectByteSize(buf, offset = 0) {
        return buf.byteLength - offset === BaseAtoms.byteSize;
    }
    /**
     * Returns a readable version of {@link BaseAtoms} properties
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
exports.BaseAtoms = BaseAtoms;
/**
 * @category Accounts
 * @category generated
 */
exports.baseAtomsBeet = new beet.BeetStruct([['inner', beet.u64]], BaseAtoms.fromArgs, 'BaseAtoms');
