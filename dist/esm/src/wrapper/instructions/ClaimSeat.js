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
 * @category ClaimSeat
 * @category generated
 */
export const ClaimSeatStruct = new beet.BeetArgsStruct([['instructionDiscriminator', beet.u8]], 'ClaimSeatInstructionArgs');
export const claimSeatInstructionDiscriminator = 1;
/**
 * Creates a _ClaimSeat_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @category Instructions
 * @category ClaimSeat
 * @category generated
 */
export function createClaimSeatInstruction(accounts, programId = new web3.PublicKey('wMNFSTkir3HgyZTsB7uqu3i7FA73grFCptPXgrZjksL')) {
    const [data] = ClaimSeatStruct.serialize({
        instructionDiscriminator: claimSeatInstructionDiscriminator,
    });
    const keys = [
        {
            pubkey: accounts.manifestProgram,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.owner,
            isWritable: true,
            isSigner: true,
        },
        {
            pubkey: accounts.market,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: accounts.systemProgram ?? web3.SystemProgram.programId,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: accounts.wrapperState,
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
