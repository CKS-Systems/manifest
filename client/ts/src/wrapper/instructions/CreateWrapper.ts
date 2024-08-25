/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as beet from "@metaplex-foundation/beet";
import * as web3 from "@solana/web3.js";

/**
 * @category Instructions
 * @category CreateWrapper
 * @category generated
 */
export const CreateWrapperStruct = new beet.BeetArgsStruct<{
  instructionDiscriminator: number;
}>([["instructionDiscriminator", beet.u8]], "CreateWrapperInstructionArgs");
/**
 * Accounts required by the _CreateWrapper_ instruction
 *
 * @property [_writable_, **signer**] owner
 * @property [_writable_, **signer**] payer
 * @property [_writable_] wrapperState
 * @category Instructions
 * @category CreateWrapper
 * @category generated
 */
export type CreateWrapperInstructionAccounts = {
  owner: web3.PublicKey;
  systemProgram?: web3.PublicKey;
  payer: web3.PublicKey;
  wrapperState: web3.PublicKey;
};

export const createWrapperInstructionDiscriminator = 0;

/**
 * Creates a _CreateWrapper_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @category Instructions
 * @category CreateWrapper
 * @category generated
 */
export function createCreateWrapperInstruction(
  accounts: CreateWrapperInstructionAccounts,
  programId = new web3.PublicKey("wMNFSTkir3HgyZTsB7uqu3i7FA73grFCptPXgrZjksL"),
) {
  const [data] = CreateWrapperStruct.serialize({
    instructionDiscriminator: createWrapperInstructionDiscriminator,
  });
  const keys: web3.AccountMeta[] = [
    {
      pubkey: accounts.owner,
      isWritable: true,
      isSigner: true,
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
