/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as splToken from '@solana/spl-token';
import * as beet from '@metaplex-foundation/beet';
import * as web3 from '@solana/web3.js';
import {
  GlobalDepositParams,
  globalDepositParamsBeet,
} from '../types/GlobalDepositParams';

/**
 * @category Instructions
 * @category GlobalDeposit
 * @category generated
 */
export type GlobalDepositInstructionArgs = {
  params: GlobalDepositParams;
};
/**
 * @category Instructions
 * @category GlobalDeposit
 * @category generated
 */
export const GlobalDepositStruct = new beet.BeetArgsStruct<
  GlobalDepositInstructionArgs & {
    instructionDiscriminator: number;
  }
>(
  [
    ['instructionDiscriminator', beet.u8],
    ['params', globalDepositParamsBeet],
  ],
  'GlobalDepositInstructionArgs',
);
/**
 * Accounts required by the _GlobalDeposit_ instruction
 *
 * @property [_writable_, **signer**] payer
 * @property [_writable_] global
 * @property [] mint
 * @property [_writable_] globalVault
 * @property [_writable_] traderToken
 * @category Instructions
 * @category GlobalDeposit
 * @category generated
 */
export type GlobalDepositInstructionAccounts = {
  payer: web3.PublicKey;
  global: web3.PublicKey;
  mint: web3.PublicKey;
  globalVault: web3.PublicKey;
  traderToken: web3.PublicKey;
  tokenProgram?: web3.PublicKey;
};

export const globalDepositInstructionDiscriminator = 9;

/**
 * Creates a _GlobalDeposit_ instruction.
 *
 * @param accounts that will be accessed while the instruction is processed
 * @param args to provide as instruction data to the program
 *
 * @category Instructions
 * @category GlobalDeposit
 * @category generated
 */
export function createGlobalDepositInstruction(
  accounts: GlobalDepositInstructionAccounts,
  args: GlobalDepositInstructionArgs,
  programId = new web3.PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms'),
) {
  const [data] = GlobalDepositStruct.serialize({
    instructionDiscriminator: globalDepositInstructionDiscriminator,
    ...args,
  });
  const keys: web3.AccountMeta[] = [
    {
      pubkey: accounts.payer,
      isWritable: true,
      isSigner: true,
    },
    {
      pubkey: accounts.global,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.mint,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: accounts.globalVault,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.traderToken,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.tokenProgram ?? splToken.TOKEN_PROGRAM_ID,
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
