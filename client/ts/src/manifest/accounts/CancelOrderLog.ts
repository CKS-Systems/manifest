/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as web3 from "@solana/web3.js";
import * as beet from "@metaplex-foundation/beet";
import * as beetSolana from "@metaplex-foundation/beet-solana";

/**
 * Arguments used to create {@link CancelOrderLog}
 * @category Accounts
 * @category generated
 */
export type CancelOrderLogArgs = {
  market: web3.PublicKey;
  trader: web3.PublicKey;
  orderSequenceNumber: beet.bignum;
};
/**
 * Holds the data for the {@link CancelOrderLog} Account and provides de/serialization
 * functionality for that data
 *
 * @category Accounts
 * @category generated
 */
export class CancelOrderLog implements CancelOrderLogArgs {
  private constructor(
    readonly market: web3.PublicKey,
    readonly trader: web3.PublicKey,
    readonly orderSequenceNumber: beet.bignum,
  ) {}

  /**
   * Creates a {@link CancelOrderLog} instance from the provided args.
   */
  static fromArgs(args: CancelOrderLogArgs) {
    return new CancelOrderLog(
      args.market,
      args.trader,
      args.orderSequenceNumber,
    );
  }

  /**
   * Deserializes the {@link CancelOrderLog} from the data of the provided {@link web3.AccountInfo}.
   * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
   */
  static fromAccountInfo(
    accountInfo: web3.AccountInfo<Buffer>,
    offset = 0,
  ): [CancelOrderLog, number] {
    return CancelOrderLog.deserialize(accountInfo.data, offset);
  }

  /**
   * Retrieves the account info from the provided address and deserializes
   * the {@link CancelOrderLog} from its data.
   *
   * @throws Error if no account info is found at the address or if deserialization fails
   */
  static async fromAccountAddress(
    connection: web3.Connection,
    address: web3.PublicKey,
    commitmentOrConfig?: web3.Commitment | web3.GetAccountInfoConfig,
  ): Promise<CancelOrderLog> {
    const accountInfo = await connection.getAccountInfo(
      address,
      commitmentOrConfig,
    );
    if (accountInfo == null) {
      throw new Error(`Unable to find CancelOrderLog account at ${address}`);
    }
    return CancelOrderLog.fromAccountInfo(accountInfo, 0)[0];
  }

  /**
   * Provides a {@link web3.Connection.getProgramAccounts} config builder,
   * to fetch accounts matching filters that can be specified via that builder.
   *
   * @param programId - the program that owns the accounts we are filtering
   */
  static gpaBuilder(
    programId: web3.PublicKey = new web3.PublicKey(
      "MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms",
    ),
  ) {
    return beetSolana.GpaBuilder.fromStruct(programId, cancelOrderLogBeet);
  }

  /**
   * Deserializes the {@link CancelOrderLog} from the provided data Buffer.
   * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
   */
  static deserialize(buf: Buffer, offset = 0): [CancelOrderLog, number] {
    return cancelOrderLogBeet.deserialize(buf, offset);
  }

  /**
   * Serializes the {@link CancelOrderLog} into a Buffer.
   * @returns a tuple of the created Buffer and the offset up to which the buffer was written to store it.
   */
  serialize(): [Buffer, number] {
    return cancelOrderLogBeet.serialize(this);
  }

  /**
   * Returns the byteSize of a {@link Buffer} holding the serialized data of
   * {@link CancelOrderLog}
   */
  static get byteSize() {
    return cancelOrderLogBeet.byteSize;
  }

  /**
   * Fetches the minimum balance needed to exempt an account holding
   * {@link CancelOrderLog} data from rent
   *
   * @param connection used to retrieve the rent exemption information
   */
  static async getMinimumBalanceForRentExemption(
    connection: web3.Connection,
    commitment?: web3.Commitment,
  ): Promise<number> {
    return connection.getMinimumBalanceForRentExemption(
      CancelOrderLog.byteSize,
      commitment,
    );
  }

  /**
   * Determines if the provided {@link Buffer} has the correct byte size to
   * hold {@link CancelOrderLog} data.
   */
  static hasCorrectByteSize(buf: Buffer, offset = 0) {
    return buf.byteLength - offset === CancelOrderLog.byteSize;
  }

  /**
   * Returns a readable version of {@link CancelOrderLog} properties
   * and can be used to convert to JSON and/or logging
   */
  pretty() {
    return {
      market: this.market.toBase58(),
      trader: this.trader.toBase58(),
      orderSequenceNumber: (() => {
        const x = <{ toNumber: () => number }>this.orderSequenceNumber;
        if (typeof x.toNumber === "function") {
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
export const cancelOrderLogBeet = new beet.BeetStruct<
  CancelOrderLog,
  CancelOrderLogArgs
>(
  [
    ["market", beetSolana.publicKey],
    ["trader", beetSolana.publicKey],
    ["orderSequenceNumber", beet.u64],
  ],
  CancelOrderLog.fromArgs,
  "CancelOrderLog",
);
