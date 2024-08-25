/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from '@metaplex-foundation/beet';
import * as web3 from '@solana/web3.js';
import {
  WrapperBatchUpdateParams,
  wrapperBatchUpdateParamsBeet,
} from '../types/WrapperBatchUpdateParams';

/**
 * @category Instructions
 * @category BatchUpdate
 * @category generated
 */
export type BatchUpdateInstructionArgs = {
  params: WrapperBatchUpdateParams;
};
/**
 * @category Instructions
 * @category BatchUpdate
 * @category generated
 */
export const BatchUpdateStruct = new beet.FixableBeetArgsStruct<
  BatchUpdateInstructionArgs & {
    instructionDiscriminator: number;
  }
>(
  [
    ['instructionDiscriminator', beet.u8],
    ['params', wrapperBatchUpdateParamsBeet],
  ],
  'BatchUpdateInstructionArgs',
);
/**
 * Accounts required by the _BatchUpdate_ instruction
 *
 * @property [] manifestProgram
 * @property [_writable_, **signer**] owner
 * @property [_writable_] market
 * @property [_writable_, **signer**] payer
 * @property [_writable_] wrapperState
 * @category Instructions
 * @category BatchUpdate
 * @category generated
 */
export type BatchUpdateInstructionAccounts = {
  manifestProgram: web3.PublicKey;
  owner: web3.PublicKey;
  market: web3.PublicKey;
  systemProgram?: web3.PublicKey;
  payer: web3.PublicKey;
  wrapperState: web3.PublicKey;
};

export const batchUpdateInstructionDiscriminator = 4;

/**
 * Creates a _BatchUpdate_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @param args to provide as instruction data to the program
 *
 * @category Instructions
 * @category BatchUpdate
 * @category generated
 */
export function createBatchUpdateInstruction(
  accounts: BatchUpdateInstructionAccounts,
  args: BatchUpdateInstructionArgs,
  programId = new web3.PublicKey('wMNFSTkir3HgyZTsB7uqu3i7FA73grFCptPXgrZjksL'),
) {
  const [data] = BatchUpdateStruct.serialize({
    instructionDiscriminator: batchUpdateInstructionDiscriminator,
    ...args,
  });
  const keys: web3.AccountMeta[] = [
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
      pubkey: accounts.payer,
      isWritable: true,
      isSigner: true,
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
