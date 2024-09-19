/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
import * as beet from '@metaplex-foundation/beet';
import * as web3 from '@solana/web3.js';
import { WithdrawParams } from '../types/WithdrawParams';
/**
 * @category Instructions
 * @category Withdraw
 * @category generated
 */
export type WithdrawInstructionArgs = {
    params: WithdrawParams;
};
/**
 * @category Instructions
 * @category Withdraw
 * @category generated
 */
export declare const WithdrawStruct: beet.BeetArgsStruct<WithdrawInstructionArgs & {
    instructionDiscriminator: number;
}>;
/**
 * Accounts required by the _Withdraw_ instruction
 *
 * @property [_writable_, **signer**] payer
 * @property [_writable_] market
 * @property [_writable_] traderToken
 * @property [_writable_] vault
 * @property [] mint
 * @category Instructions
 * @category Withdraw
 * @category generated
 */
export type WithdrawInstructionAccounts = {
    payer: web3.PublicKey;
    market: web3.PublicKey;
    traderToken: web3.PublicKey;
    vault: web3.PublicKey;
    tokenProgram?: web3.PublicKey;
    mint: web3.PublicKey;
};
export declare const withdrawInstructionDiscriminator = 3;
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
export declare function createWithdrawInstruction(accounts: WithdrawInstructionAccounts, args: WithdrawInstructionArgs, programId?: web3.PublicKey): web3.TransactionInstruction;
//# sourceMappingURL=Withdraw.d.ts.map