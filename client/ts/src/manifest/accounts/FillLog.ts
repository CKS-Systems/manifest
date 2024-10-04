/**
 * This code was GENERATED using the solita package.
 * Please DO NOT EDIT THIS FILE, instead rerun solita to update it or write a wrapper to add functionality.
 *
 * See: https://github.com/metaplex-foundation/solita
 */

import * as web3 from '@solana/web3.js';
import * as beet from '@metaplex-foundation/beet';
import * as beetSolana from '@metaplex-foundation/beet-solana';
import {
  QuoteAtomsPerBaseAtom,
  quoteAtomsPerBaseAtomBeet,
} from './QuoteAtomsPerBaseAtom';
import { BaseAtoms, baseAtomsBeet } from './BaseAtoms';
import { QuoteAtoms, quoteAtomsBeet } from './QuoteAtoms';

/**
 * Arguments used to create {@link FillLog}
 * @category Accounts
 * @category generated
 */
export type FillLogArgs = {
  market: web3.PublicKey;
  maker: web3.PublicKey;
  taker: web3.PublicKey;
  price: QuoteAtomsPerBaseAtom;
  baseAtoms: BaseAtoms;
  quoteAtoms: QuoteAtoms;
  makerSequenceNumber: beet.bignum;
  takerSequenceNumber: beet.bignum;
  takerIsBuy: boolean;
  isMakerGlobal: boolean;
  padding: number[] /* size: 14 */;
};
/**
 * Holds the data for the {@link FillLog} Account and provides de/serialization
 * functionality for that data
 *
 * @category Accounts
 * @category generated
 */
export class FillLog implements FillLogArgs {
  private constructor(
    readonly market: web3.PublicKey,
    readonly maker: web3.PublicKey,
    readonly taker: web3.PublicKey,
    readonly price: QuoteAtomsPerBaseAtom,
    readonly baseAtoms: BaseAtoms,
    readonly quoteAtoms: QuoteAtoms,
    readonly makerSequenceNumber: beet.bignum,
    readonly takerSequenceNumber: beet.bignum,
    readonly takerIsBuy: boolean,
    readonly isMakerGlobal: boolean,
    readonly padding: number[] /* size: 14 */,
  ) {}

  /**
   * Creates a {@link FillLog} instance from the provided args.
   */
  static fromArgs(args: FillLogArgs) {
    return new FillLog(
      args.market,
      args.maker,
      args.taker,
      args.price,
      args.baseAtoms,
      args.quoteAtoms,
      args.makerSequenceNumber,
      args.takerSequenceNumber,
      args.takerIsBuy,
      args.isMakerGlobal,
      args.padding,
    );
  }

  /**
   * Deserializes the {@link FillLog} from the data of the provided {@link web3.AccountInfo}.
   * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
   */
  static fromAccountInfo(
    accountInfo: web3.AccountInfo<Buffer>,
    offset = 0,
  ): [FillLog, number] {
    return FillLog.deserialize(accountInfo.data, offset);
  }

  /**
   * Retrieves the account info from the provided address and deserializes
   * the {@link FillLog} from its data.
   *
   * @throws Error if no account info is found at the address or if deserialization fails
   */
  static async fromAccountAddress(
    connection: web3.Connection,
    address: web3.PublicKey,
    commitmentOrConfig?: web3.Commitment | web3.GetAccountInfoConfig,
  ): Promise<FillLog> {
    const accountInfo = await connection.getAccountInfo(
      address,
      commitmentOrConfig,
    );
    if (accountInfo == null) {
      throw new Error(`Unable to find FillLog account at ${address}`);
    }
    return FillLog.fromAccountInfo(accountInfo, 0)[0];
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
    return beetSolana.GpaBuilder.fromStruct(programId, fillLogBeet);
  }

  /**
   * Deserializes the {@link FillLog} from the provided data Buffer.
   * @returns a tuple of the account data and the offset up to which the buffer was read to obtain it.
   */
  static deserialize(buf: Buffer, offset = 0): [FillLog, number] {
    return fillLogBeet.deserialize(buf, offset);
  }

  /**
   * Serializes the {@link FillLog} into a Buffer.
   * @returns a tuple of the created Buffer and the offset up to which the buffer was written to store it.
   */
  serialize(): [Buffer, number] {
    return fillLogBeet.serialize(this);
  }

  /**
   * Returns the byteSize of a {@link Buffer} holding the serialized data of
   * {@link FillLog}
   */
  static get byteSize() {
    return fillLogBeet.byteSize;
  }

  /**
   * Fetches the minimum balance needed to exempt an account holding
   * {@link FillLog} data from rent
   *
   * @param connection used to retrieve the rent exemption information
   */
  static async getMinimumBalanceForRentExemption(
    connection: web3.Connection,
    commitment?: web3.Commitment,
  ): Promise<number> {
    return connection.getMinimumBalanceForRentExemption(
      FillLog.byteSize,
      commitment,
    );
  }

  /**
   * Determines if the provided {@link Buffer} has the correct byte size to
   * hold {@link FillLog} data.
   */
  static hasCorrectByteSize(buf: Buffer, offset = 0) {
    return buf.byteLength - offset === FillLog.byteSize;
  }

  /**
   * Returns a readable version of {@link FillLog} properties
   * and can be used to convert to JSON and/or logging
   */
  pretty() {
    return {
      market: this.market.toBase58(),
      maker: this.maker.toBase58(),
      taker: this.taker.toBase58(),
      price: this.price,
      baseAtoms: this.baseAtoms,
      quoteAtoms: this.quoteAtoms,
      makerSequenceNumber: (() => {
        const x = <{ toNumber: () => number }>this.makerSequenceNumber;
        if (typeof x.toNumber === 'function') {
          try {
            return x.toNumber();
          } catch (_) {
            return x;
          }
        }
        return x;
      })(),
      takerSequenceNumber: (() => {
        const x = <{ toNumber: () => number }>this.takerSequenceNumber;
        if (typeof x.toNumber === 'function') {
          try {
            return x.toNumber();
          } catch (_) {
            return x;
          }
        }
        return x;
      })(),
      takerIsBuy: this.takerIsBuy,
      isMakerGlobal: this.isMakerGlobal,
      padding: this.padding,
    };
  }
}

/**
 * @category Accounts
 * @category generated
 */
export const fillLogBeet = new beet.BeetStruct<FillLog, FillLogArgs>(
  [
    ['market', beetSolana.publicKey],
    ['maker', beetSolana.publicKey],
    ['taker', beetSolana.publicKey],
    ['price', quoteAtomsPerBaseAtomBeet],
    ['baseAtoms', baseAtomsBeet],
    ['quoteAtoms', quoteAtomsBeet],
    ['makerSequenceNumber', beet.u64],
    ['takerSequenceNumber', beet.u64],
    ['takerIsBuy', beet.bool],
    ['isMakerGlobal', beet.bool],
    ['padding', beet.uniformFixedSizeArray(beet.u8, 14)],
  ],
  FillLog.fromArgs,
  'FillLog',
);
