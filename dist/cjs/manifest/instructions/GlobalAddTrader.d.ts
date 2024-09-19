/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */
import * as beet from '@metaplex-foundation/beet';
import * as web3 from '@solana/web3.js';
/**
 * @category Instructions
 * @category GlobalAddTrader
 * @category generated
 */
export declare const GlobalAddTraderStruct: beet.BeetArgsStruct<{
    instructionDiscriminator: number;
}>;
/**
 * Accounts required by the _GlobalAddTrader_ instruction
 *
 * @property [_writable_, **signer**] payer
 * @property [_writable_] global
 * @category Instructions
 * @category GlobalAddTrader
 * @category generated
 */
export type GlobalAddTraderInstructionAccounts = {
    payer: web3.PublicKey;
    global: web3.PublicKey;
    systemProgram?: web3.PublicKey;
};
export declare const globalAddTraderInstructionDiscriminator = 8;
/**
 * Creates a _GlobalAddTrader_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @category Instructions
 * @category GlobalAddTrader
 * @category generated
 */
export declare function createGlobalAddTraderInstruction(accounts: GlobalAddTraderInstructionAccounts, programId?: web3.PublicKey): web3.TransactionInstruction;
