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
exports.globalEvictLogBeet = exports.GlobalEvictLog = void 0;
const web3 = __importStar(require("@solana/web3.js"));
const beetSolana = __importStar(require("@metaplex-foundation/beet-solana"));
const beet = __importStar(require("@metaplex-foundation/beet"));
const GlobalAtoms_1 = require("./GlobalAtoms");
/**
 * Holds the data for the {@link GlobalEvictLog} Account and provides de/serialization
 * functionality for that data
 *
 * @category Accounts
 * @category generated
 */
class GlobalEvictLog {
    evictor;
    evictee;
    evictorAtoms;
    evicteeAtoms;
    constructor(evictor, evictee, evictorAtoms, evicteeAtoms) {
        this.evictor = evictor;
        this.evictee = evictee;
        this.evictorAtoms = evictorAtoms;
        this.evicteeAtoms = evicteeAtoms;
    }
    /**
     * Creates a {@link GlobalEvictLog} instance from the provided args.
     */
    static fromArgs(args) {
        return new GlobalEvictLog(args.evictor, args.evictee, args.evictorAtoms, args.evicteeAtoms);
    }
    /**
     * Deserializes the {@link GlobalEvictLog} from the data of the provided {@link web3.AccountInfo}.
     * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
     */
    static fromAccountInfo(accountInfo, offset = 0) {
        return GlobalEvictLog.deserialize(accountInfo.data, offset);
    }
    /**
     * Retrieves the account info from the provided address and deserializes
     * the {@link GlobalEvictLog} from its data.
     *
     * @throws Error if no account info is found at the address or if deserialization fails
     */
    static async fromAccountAddress(connection, address, commitmentOrConfig) {
        const accountInfo = await connection.getAccountInfo(address, commitmentOrConfig);
        if (accountInfo == null) {
            throw new Error(`Unable to find GlobalEvictLog account at ${address}`);
        }
        return GlobalEvictLog.fromAccountInfo(accountInfo, 0)[0];
    }
    /**
     * Provides a {@link web3.Connection.getProgramAccounts} config builder,
     * to fetch accounts matching filters that can be specified via that builder.
     *
     * @param programId - the program that owns the accounts we are filtering
     */
    static gpaBuilder(programId = new web3.PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms')) {
        return beetSolana.GpaBuilder.fromStruct(programId, exports.globalEvictLogBeet);
    }
    /**
     * Deserializes the {@link GlobalEvictLog} from the provided data Buffer.
     * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
     */
    static deserialize(buf, offset = 0) {
        return exports.globalEvictLogBeet.deserialize(buf, offset);
    }
    /**
     * Serializes the {@link GlobalEvictLog} into a Buffer.
     * @returns a tuple of the created Buffer and the offset up to which the buffer was written to store it.
     */
    serialize() {
        return exports.globalEvictLogBeet.serialize(this);
    }
    /**
     * Returns the byteSize of a {@link Buffer} holding the serialized data of
     * {@link GlobalEvictLog}
     */
    static get byteSize() {
        return exports.globalEvictLogBeet.byteSize;
    }
    /**
     * Fetches the minimum balance needed to exempt an account holding
     * {@link GlobalEvictLog} data from rent
     *
     * @param connection used to retrieve the rent exemption information
     */
    static async getMinimumBalanceForRentExemption(connection, commitment) {
        return connection.getMinimumBalanceForRentExemption(GlobalEvictLog.byteSize, commitment);
    }
    /**
     * Determines if the provided {@link Buffer} has the correct byte size to
     * hold {@link GlobalEvictLog} data.
     */
    static hasCorrectByteSize(buf, offset = 0) {
        return buf.byteLength - offset === GlobalEvictLog.byteSize;
    }
    /**
     * Returns a readable version of {@link GlobalEvictLog} properties
     * and can be used to convert to JSON and/or logging
     */
    pretty() {
        return {
            evictor: this.evictor.toBase58(),
            evictee: this.evictee.toBase58(),
            evictorAtoms: this.evictorAtoms,
            evicteeAtoms: this.evicteeAtoms,
        };
    }
}
exports.GlobalEvictLog = GlobalEvictLog;
/**
 * @category Accounts
 * @category generated
 */
exports.globalEvictLogBeet = new beet.BeetStruct([
    ['evictor', beetSolana.publicKey],
    ['evictee', beetSolana.publicKey],
    ['evictorAtoms', GlobalAtoms_1.globalAtomsBeet],
    ['evicteeAtoms', GlobalAtoms_1.globalAtomsBeet],
], GlobalEvictLog.fromArgs, 'GlobalEvictLog');
