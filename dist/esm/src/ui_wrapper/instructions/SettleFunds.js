/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
import * as beet from '@metaplex-foundation/beet';
import * as web3 from '@solana/web3.js';
import { wrapperSettleFundsParamsBeet, } from '../types/WrapperSettleFundsParams';
/**
 * @category Instructions
 * @category SettleFunds
 * @category generated
 */
export const SettleFundsStruct = new beet.BeetArgsStruct([
    ['instructionDiscriminator', beet.u8],
    ['params', wrapperSettleFundsParamsBeet],
], 'SettleFundsInstructionArgs');
export const settleFundsInstructionDiscriminator = 5;
/**
 * Creates a _SettleFunds_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @param args to provide as instruction data to the program
 *
 * @category Instructions
 * @category SettleFunds
 * @category generated
 */
export function createSettleFundsInstruction(accounts, args, programId = new web3.PublicKey('UMnFStVeG1ecZFc2gc5K3vFy3sMpotq8C91mXBQDGwh')) {
    const [data] = SettleFundsStruct.serialize({
        instructionDiscriminator: settleFundsInstructionDiscriminator,
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
            pubkey: accounts.traderTokenAccountBase,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.traderTokenAccountQuote,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.market,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.vaultBase,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.vaultQuote,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.mintBase,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.mintQuote,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.executorProgram,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.tokenProgramBase,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.tokenProgramQuote,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.manifestProgram,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.platformTokenAccount,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.referrerTokenAccount,
            isWritable: true,
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
