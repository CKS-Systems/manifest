/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
import * as splToken from '@solana/spl-token';
import * as beet from '@metaplex-foundation/beet';
import * as web3 from '@solana/web3.js';
import { withdrawParamsBeet } from '../types/WithdrawParams';
/**
 * @category Instructions
 * @category Withdraw
 * @category generated
 */
export const WithdrawStruct = new beet.BeetArgsStruct([
    ['instructionDiscriminator', beet.u8],
    ['params', withdrawParamsBeet],
], 'WithdrawInstructionArgs');
export const withdrawInstructionDiscriminator = 3;
/**
 * Creates a _Withdraw_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @param args to provide as instruction data to the program
 *
 * @category Instructions
 * @category Withdraw
 * @category generated
 */
export function createWithdrawInstruction(accounts, args, programId = new web3.PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms')) {
    const [data] = WithdrawStruct.serialize({
        instructionDiscriminator: withdrawInstructionDiscriminator,
        ...args,
    });
    const keys = [
        {
            pubkey: accounts.payer,
            isWritable: true,
            isSigner: true,
        },
        {
            pubkey: accounts.market,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.traderToken,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.vault,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.tokenProgram ?? splToken.TOKEN_PROGRAM_ID,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.mint,
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
