/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as web3 from '@solana/web3.js';
import * as beet from '@metaplex-foundation/beet';
import * as beetSolana from '@metaplex-foundation/beet-solana';

/**
 * Arguments used to create {@link WithdrawLog}
 * @category Accounts
 * @category generated
 */
export type WithdrawLogArgs = {
  market: web3.PublicKey;
  trader: web3.PublicKey;
  mint: web3.PublicKey;
  amountAtoms: beet.bignum;
};
/**
 * Holds the data for the {@link WithdrawLog} Account and provides de/serialization
 * functionality for that data
 *
 * @category Accounts
 * @category generated
 */
export class WithdrawLog implements WithdrawLogArgs {
  private constructor(
    readonly market: web3.PublicKey,
    readonly trader: web3.PublicKey,
    readonly mint: web3.PublicKey,
    readonly amountAtoms: beet.bignum,
  ) {}

  /**
   * Creates a {@link WithdrawLog} instance from the provided args.
   */
  static fromArgs(args: WithdrawLogArgs) {
    return new WithdrawLog(
      args.market,
      args.trader,
      args.mint,
      args.amountAtoms,
    );
  }

  /**
   * Deserializes the {@link WithdrawLog} from the data of the provided {@link web3.AccountInfo}.
   * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
   */
  static fromAccountInfo(
    accountInfo: web3.AccountInfo<Buffer>,
    offset = 0,
  ): [WithdrawLog, number] {
    return WithdrawLog.deserialize(accountInfo.data, offset);
  }

  /**
   * Retrieves the account info from the provided address and deserializes
   * the {@link WithdrawLog} from its data.
   *
   * @throws Error if no account info is found at the address or if deserialization fails
   */
  static async fromAccountAddress(
    connection: web3.Connection,
    address: web3.PublicKey,
    commitmentOrConfig?: web3.Commitment | web3.GetAccountInfoConfig,
  ): Promise<WithdrawLog> {
    const accountInfo = await connection.getAccountInfo(
      address,
      commitmentOrConfig,
    );
    if (accountInfo == null) {
      throw new Error(`Unable to find WithdrawLog account at ${address}`);
    }
    return WithdrawLog.fromAccountInfo(accountInfo, 0)[0];
  }

  /**
   * Provides a {@link web3.Connection.getProgramAccounts} config builder,
   * to fetch accounts matching filters that can be specified via that builder.
   *
   * @param programId - the program that owns the accounts we are filtering
   */
  static gpaBuilder(
    programId: web3.PublicKey = new web3.PublicKey(
      'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms',
    ),
  ) {
    return beetSolana.GpaBuilder.fromStruct(programId, withdrawLogBeet);
  }

  /**
   * Deserializes the {@link WithdrawLog} from the provided data Buffer.
   * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
   */
  static deserialize(buf: Buffer, offset = 0): [WithdrawLog, number] {
    return withdrawLogBeet.deserialize(buf, offset);
  }

  /**
   * Serializes the {@link WithdrawLog} into a Buffer.
   * @returns a tuple of the created Buffer and the offset up to which the buffer was written to store it.
   */
  serialize(): [Buffer, number] {
    return withdrawLogBeet.serialize(this);
  }

  /**
   * Returns the byteSize of a {@link Buffer} holding the serialized data of
   * {@link WithdrawLog}
   */
  static get byteSize() {
    return withdrawLogBeet.byteSize;
  }

  /**
   * Fetches the minimum balance needed to exempt an account holding
   * {@link WithdrawLog} data from rent
   *
   * @param connection used to retrieve the rent exemption information
   */
  static async getMinimumBalanceForRentExemption(
    connection: web3.Connection,
    commitment?: web3.Commitment,
  ): Promise<number> {
    return connection.getMinimumBalanceForRentExemption(
      WithdrawLog.byteSize,
      commitment,
    );
  }

  /**
   * Determines if the provided {@link Buffer} has the correct byte size to
   * hold {@link WithdrawLog} data.
   */
  static hasCorrectByteSize(buf: Buffer, offset = 0) {
    return buf.byteLength - offset === WithdrawLog.byteSize;
  }

  /**
   * Returns a readable version of {@link WithdrawLog} properties
   * and can be used to convert to JSON and/or logging
   */
  pretty() {
    return {
      market: this.market.toBase58(),
      trader: this.trader.toBase58(),
      mint: this.mint.toBase58(),
      amountAtoms: (() => {
        const x = <{ toNumber: () => number }>this.amountAtoms;
        if (typeof x.toNumber === 'function') {
          try {
            return x.toNumber();
          } catch (_) {
            return x;
          }
        }
        return x;
      })(),
    };
  }
}

/**
 * @category Accounts
 * @category generated
 */
export const withdrawLogBeet = new beet.BeetStruct<
  WithdrawLog,
  WithdrawLogArgs
>(
  [
    ['market', beetSolana.publicKey],
    ['trader', beetSolana.publicKey],
    ['mint', beetSolana.publicKey],
    ['amountAtoms', beet.u64],
  ],
  WithdrawLog.fromArgs,
  'WithdrawLog',
);
