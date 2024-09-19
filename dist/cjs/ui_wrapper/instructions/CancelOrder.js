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
exports.cancelOrderInstructionDiscriminator = exports.CancelOrderStruct = void 0;
exports.createCancelOrderInstruction = createCancelOrderInstruction;
const splToken = __importStar(require("@solana/spl-token"));
const beet = __importStar(require("@metaplex-foundation/beet"));
const web3 = __importStar(require("@solana/web3.js"));
const WrapperCancelOrderParams_1 = require("../types/WrapperCancelOrderParams");
/**
 * @category Instructions
 * @category CancelOrder
 * @category generated
 */
exports.CancelOrderStruct = new beet.BeetArgsStruct([
    ['instructionDiscriminator', beet.u8],
    ['params', WrapperCancelOrderParams_1.wrapperCancelOrderParamsBeet],
], 'CancelOrderInstructionArgs');
exports.cancelOrderInstructionDiscriminator = 4;
/**
 * Creates a _CancelOrder_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @param args to provide as instruction data to the program
 *
 * @category Instructions
 * @category CancelOrder
 * @category generated
 */
function createCancelOrderInstruction(accounts, args, programId = new web3.PublicKey('UMnFStVeG1ecZFc2gc5K3vFy3sMpotq8C91mXBQDGwh')) {
    const [data] = exports.CancelOrderStruct.serialize({
        instructionDiscriminator: exports.cancelOrderInstructionDiscriminator,
        ...args,
    });
    const keys = [
        {
            pubkey: accounts.wrapperState,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.owner,
            isWritable: false,
            isSigner: true,
        },
        {
            pubkey: accounts.traderTokenAccount,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.market,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.vault,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.mint,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.systemProgram ?? web3.SystemProgram.programId,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.tokenProgram ?? splToken.TOKEN_PROGRAM_ID,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.manifestProgram,
            isWritable: false,
            isSigner: false,
        },
    ];
    const ix = new web3.TransactionInstruction({
        programId,
        keys,
        data,
    });
    return ix;
}
