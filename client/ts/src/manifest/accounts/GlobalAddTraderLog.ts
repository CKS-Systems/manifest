/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as web3 from '@solana/web3.js';
import * as beetSolana from '@metaplex-foundation/beet-solana';
import * as beet from '@metaplex-foundation/beet';

/**
 * Arguments used to create {@link GlobalAddTraderLog}
 * @category Accounts
 * @category generated
 */
export type GlobalAddTraderLogArgs = {
  global: web3.PublicKey;
  trader: web3.PublicKey;
};
/**
 * Holds the data for the {@link GlobalAddTraderLog} Account and provides de/serialization
 * functionality for that data
 *
 * @category Accounts
 * @category generated
 */
export class GlobalAddTraderLog implements GlobalAddTraderLogArgs {
  private constructor(
    readonly global: web3.PublicKey,
    readonly trader: web3.PublicKey,
  ) {}

  /**
   * Creates a {@link GlobalAddTraderLog} instance from the provided args.
   */
  static fromArgs(args: GlobalAddTraderLogArgs) {
    return new GlobalAddTraderLog(args.global, args.trader);
  }

  /**
   * Deserializes the {@link GlobalAddTraderLog} from the data of the provided {@link web3.AccountInfo}.
   * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
   */
  static fromAccountInfo(
    accountInfo: web3.AccountInfo<Buffer>,
    offset = 0,
  ): [GlobalAddTraderLog, number] {
    return GlobalAddTraderLog.deserialize(accountInfo.data, offset);
  }

  /**
   * Retrieves the account info from the provided address and deserializes
   * the {@link GlobalAddTraderLog} from its data.
   *
   * @throws Error if no account info is found at the address or if deserialization fails
   */
  static async fromAccountAddress(
    connection: web3.Connection,
    address: web3.PublicKey,
    commitmentOrConfig?: web3.Commitment | web3.GetAccountInfoConfig,
  ): Promise<GlobalAddTraderLog> {
    const accountInfo = await connection.getAccountInfo(
      address,
      commitmentOrConfig,
    );
    if (accountInfo == null) {
      throw new Error(
        `Unable to find GlobalAddTraderLog account at ${address}`,
      );
    }
    return GlobalAddTraderLog.fromAccountInfo(accountInfo, 0)[0];
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
    return beetSolana.GpaBuilder.fromStruct(programId, globalAddTraderLogBeet);
  }

  /**
   * Deserializes the {@link GlobalAddTraderLog} from the provided data Buffer.
   * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
   */
  static deserialize(buf: Buffer, offset = 0): [GlobalAddTraderLog, number] {
    return globalAddTraderLogBeet.deserialize(buf, offset);
  }

  /**
   * Serializes the {@link GlobalAddTraderLog} into a Buffer.
   * @returns a tuple of the created Buffer and the offset up to which the buffer was written to store it.
   */
  serialize(): [Buffer, number] {
    return globalAddTraderLogBeet.serialize(this);
  }

  /**
   * Returns the byteSize of a {@link Buffer} holding the serialized data of
   * {@link GlobalAddTraderLog}
   */
  static get byteSize() {
    return globalAddTraderLogBeet.byteSize;
  }

  /**
   * Fetches the minimum balance needed to exempt an account holding
   * {@link GlobalAddTraderLog} data from rent
   *
   * @param connection used to retrieve the rent exemption information
   */
  static async getMinimumBalanceForRentExemption(
    connection: web3.Connection,
    commitment?: web3.Commitment,
  ): Promise<number> {
    return connection.getMinimumBalanceForRentExemption(
      GlobalAddTraderLog.byteSize,
      commitment,
    );
  }

  /**
   * Determines if the provided {@link Buffer} has the correct byte size to
   * hold {@link GlobalAddTraderLog} data.
   */
  static hasCorrectByteSize(buf: Buffer, offset = 0) {
    return buf.byteLength - offset === GlobalAddTraderLog.byteSize;
  }

  /**
   * Returns a readable version of {@link GlobalAddTraderLog} properties
   * and can be used to convert to JSON and/or logging
   */
  pretty() {
    return {
      global: this.global.toBase58(),
      trader: this.trader.toBase58(),
    };
  }
}

/**
 * @category Accounts
 * @category generated
 */
export const globalAddTraderLogBeet = new beet.BeetStruct<
  GlobalAddTraderLog,
  GlobalAddTraderLogArgs
>(
  [
    ['global', beetSolana.publicKey],
    ['trader', beetSolana.publicKey],
  ],
  GlobalAddTraderLog.fromArgs,
  'GlobalAddTraderLog',
);