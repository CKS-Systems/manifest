import { PublicKey, Connection } from '@solana/web3.js';
import { bignum } from '@metaplex-foundation/beet';
import { claimedSeatBeet, publicKeyBeet, restingOrderBeet } from './utils/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { deserializeRedBlackTree } from './utils/redBlackTree';
import { convertU128, toNum } from './utils/numbers';
import { FIXED_MANIFEST_HEADER_SIZE, NIL } from './constants';

/**
 * Internal use only. Needed because shank doesnt handle f64 and because the
 * client doesnt need to know about padding.
 */
export type RestingOrderInternal = {
  traderIndex: bignum;
  numBaseAtoms: bignum;
  lastValidSlot: bignum;
  sequenceNumber: bignum;
  // Deserializes to UInt8Array, but we then convert it to number.
  price: bignum;
  effectivePrice: bignum;
  padding: bignum[]; // 16 bytes
};

/**
 * RestingOrder on the market.
 */
export type RestingOrder = {
  /** Trader public key. */
  trader: PublicKey;
  /** Number of base atoms remaining in the order. */
  numBaseAtoms: bignum;
  /** Last slot before this order is invalid and will be removed. */
  lastValidSlot: bignum;
  /** Exchange defined sequenceNumber for this order, guaranteed to be unique. */
  sequenceNumber: bignum;
  /** Price as float in atoms of quote per atoms of base. */
  price: number;
};

/**
 * ClaimedSeat on the market.
 */
export type ClaimedSeat = {
  /** Public key of the trader. */
  publicKey: PublicKey;
  /** Balance of base atoms that are withdrawable (excluding in open orders). */
  baseBalance: bignum;
  /** Balance of quote atoms that are withdrawable (excluding in open orders). */
  quoteBalance: bignum;
};

/**
 * MarketData is all information stored on a market account.
 */
export interface MarketData {
  /** Version of the struct, included in case features are added later which use the padding. */
  version: number;
  /** Number of decimals for the baseMint (i.e. baseMintDecimals = 6 -> 1 baseAtom = .000001 baseToken). */
  baseMintDecimals: number;
  /** Number of decimals for the quoteMint (i.e. quoteMintDecimals = 6 -> 1 quoteAtom = .000001 quoteToken). */
  quoteMintDecimals: number;
  /** Public key for the base mint. */
  baseMint: PublicKey;
  /** Public key for the quote mint. */
  quoteMint: PublicKey;
  /** Current next order sequence number. */
  orderSequenceNumber: bigint;
  /** Number of bytes used in the dynamic portion of the market account. */
  numBytesAllocated: number;
  /** Sorted array of resting orders for bids currently on the orderbook. */
  bids: RestingOrder[];
  /** Sorted array of resting orders for asks currently on the orderbook. */
  asks: RestingOrder[];
  /** Array of all claimed seats. */
  claimedSeats: ClaimedSeat[];
}

/**
 * Market object used for reading data from a manifest market.
 */
export class Market {
  /** Public key for the market account. */
  address: PublicKey;
  /** Deserialized data. */
  private data: MarketData;

  /**
   * Constructs a Market object.
   *
   * @param address The `PublicKey` of the market account
   * @param data Deserialized market data
   */
  private constructor({
    address,
    data,
  }: {
    address: PublicKey;
    data: MarketData;
  }) {
    this.address = address;
    this.data = data;
  }

  /**
   * Returns a `Market` for a given address, a data buffer
   *
   * @param marketAddress The `PublicKey` of the market account
   * @param buffer The buffer holding the market account data
   */
  static loadFromBuffer({
    address,
    buffer,
  }: {
    address: PublicKey;
    buffer: Buffer;
  }): Market {
    const marketData = Market.deserializeMarketBuffer(buffer);
    return new Market({ address, data: marketData });
  }

  /**
   * Returns a `Market` for a given address, a data buffer
   *
   * @param connection The Solana `Connection` object
   * @param address The `PublicKey` of the market account
   */
  static async loadFromAddress({
    connection,
    address,
  }: {
    connection: Connection;
    address: PublicKey;
  }): Promise<Market> {
    const buffer = await connection
      .getAccountInfo(address, 'confirmed')
      .then((accountInfo) => accountInfo?.data);

    if (buffer === undefined) {
      throw new Error(`Failed to load ${address}`);
    }
    return Market.loadFromBuffer({ address, buffer });
  }

  /**
   * Updates the data in a Market.
   *
   * @param connection The Solana `Connection` object
   */
  public async reload(connection: Connection): Promise<void> {
    const buffer = await connection
      .getAccountInfo(this.address, 'confirmed')
      .then((accountInfo) => accountInfo?.data);
    if (buffer === undefined) {
      throw new Error(`Failed to load ${this.address}`);
    }
    this.data = Market.deserializeMarketBuffer(buffer);
  }

  /**
   * Get the amount in atoms of balance that is deposited on the exchange, does
   * not include tokens currently in open orders.
   *
   * @param trader PublicKey of the trader to check balance of
   * @param isBase boolean for whether this is checking base or quote
   *
   * @returns number in atoms
   */
  public getWithdrawableBalanceAtoms(
    trader: PublicKey,
    isBase: boolean,
  ): number {
    const filteredSeats = this.data.claimedSeats.filter((claimedSeat) => {
      return claimedSeat.publicKey.toBase58() == trader.toBase58();
    });
    // No seat claimed.
    if (filteredSeats.length == 0) {
      return 0;
    }
    const seat: ClaimedSeat = filteredSeats[0];
    return toNum(isBase ? seat.baseBalance : seat.quoteBalance);
  }

  /**
   * Gets the base mint of the market
   *
   * @returns PublicKey
   */
  public baseMint(): PublicKey {
    return this.data.baseMint;
  }

  /**
   * Gets the quote mint of the market
   *
   * @returns PublicKey
   */
  public quoteMint(): PublicKey {
    return this.data.quoteMint;
  }

  /**
   * Gets the base decimals of the market
   *
   * @returns number
   */
  public baseDecimals(): number {
    return this.data.baseMintDecimals;
  }

  /**
   * Gets the base decimals of the market
   *
   * @returns number
   */
  public quoteDecimals(): number {
    return this.data.quoteMintDecimals;
  }

  /**
   * Check whether a given public key has a claimed seat on the market
   *
   * @param trader PublicKey of the trader
   *
   * @returns boolean
   */
  public hasSeat(trader: PublicKey): boolean {
    const filteredSeats = this.data.claimedSeats.filter((claimedSeat) => {
      return claimedSeat.publicKey.toBase58() == trader.toBase58();
    });
    return filteredSeats.length > 0;
  }

  /**
   * Get all open bids on the market.
   *
   * @returns RestingOrder[]
   */
  public bids(): RestingOrder[] {
    return this.data.bids;
  }

  /**
   * Get all open asks on the market.
   *
   * @returns RestingOrder[]
   */
  public asks(): RestingOrder[] {
    return this.data.asks;
  }

  /**
   * Get all open orders on the market.
   *
   * @returns RestingOrder[]
   */
  public openOrders(): RestingOrder[] {
    return [...this.data.bids, ...this.data.asks];
  }

  /**
   * Print all information loaded about the market in a human readable format.
   */
  public prettyPrint() {
    console.log('');
    console.log(`Market: ${this.address}`);
    console.log(`========================`);
    console.log(`Version: ${this.data.version}`);
    console.log(`BaseMint: ${this.data.baseMint.toBase58()}`);
    console.log(`QuoteMint: ${this.data.quoteMint.toBase58()}`);
    console.log(`OrderSequenceNumber: ${this.data.orderSequenceNumber}`);
    console.log(`NumBytesAllocated: ${this.data.numBytesAllocated}`);
    console.log('Bids:');
    this.data.bids.forEach((bid) => {
      console.log(
        `trader: ${bid.trader} numBaseAtoms: ${bid.numBaseAtoms} price: ${bid.price} lastValidSlot: ${bid.lastValidSlot} sequenceNumber: ${bid.sequenceNumber}`,
      );
    });
    console.log('Asks:');
    this.data.asks.forEach((ask) => {
      console.log(
        `trader: ${ask.trader} numBaseAtoms: ${ask.numBaseAtoms} price: ${ask.price} lastValidSlot: ${ask.lastValidSlot} sequenceNumber: ${ask.sequenceNumber}`,
      );
    });
    console.log('ClaimedSeats:');
    this.data.claimedSeats.forEach((claimedSeat) => {
      console.log(
        `publicKey: ${claimedSeat.publicKey.toBase58()} baseBalance: ${claimedSeat.baseBalance} quoteBalance: ${claimedSeat.quoteBalance}`,
      );
    });
    console.log(`========================`);
  }

  /**
   * Deserializes market data from a given buffer and returns a `Market` object
   *
   * This includes both the fixed and dynamic parts of the market.
   * https://github.com/CKS-Systems/manifest/blob/main/programs/manifest/src/state/market.rs
   *
   * @param data The data buffer to deserialize
   */
  static deserializeMarketBuffer(data: Buffer): MarketData {
    let offset = 0;
    // Deserialize the market header
    const _discriminant = data.readBigUInt64LE(0);
    offset += 8;

    const version = data.readUInt8(offset);
    offset += 1;
    const baseMintDecimals = data.readUInt8(offset);
    offset += 1;
    const quoteMintDecimals = data.readUInt8(offset);
    offset += 1;
    const _baseVaultBump = data.readUInt8(offset);
    offset += 1;
    const _quoteVaultBump = data.readUInt8(offset);
    offset += 1;
    // 3 bytes of unused padding.
    offset += 3;

    const baseMint = beetPublicKey.read(data, offset);
    offset += beetPublicKey.byteSize;
    const quoteMint = beetPublicKey.read(data, offset);
    offset += beetPublicKey.byteSize;
    const _baseVault = beetPublicKey.read(data, offset);
    offset += beetPublicKey.byteSize;
    const _quoteVault = beetPublicKey.read(data, offset);
    offset += beetPublicKey.byteSize;

    const orderSequenceNumber = data.readBigUInt64LE(offset);
    offset += 8;

    const numBytesAllocated = data.readUInt32LE(offset);
    offset += 4;

    const bidsRootIndex = data.readUInt32LE(offset);
    offset += 4;
    const _bidsBestIndex = data.readUInt32LE(offset);
    offset += 4;

    const asksRootIndex = data.readUInt32LE(offset);
    offset += 4;
    const _askBestIndex = data.readUInt32LE(offset);
    offset += 4;

    const claimedSeatsRootIndex = data.readUInt32LE(offset);
    offset += 4;

    const _freeListHeadIndex = data.readUInt32LE(offset);
    offset += 4;

    // _padding2: [u32; 3],
    // _padding3: [u64; 8],

    const bids: RestingOrder[] =
      bidsRootIndex != NIL
        ? deserializeRedBlackTree(
            data.subarray(FIXED_MANIFEST_HEADER_SIZE),
            bidsRootIndex,
            restingOrderBeet,
          ).map((restingOrderInternal: RestingOrderInternal) => {
            return {
              ...restingOrderInternal,
              trader: publicKeyBeet.deserialize(
                data.subarray(
                  Number(restingOrderInternal.traderIndex) +
                    16 +
                    FIXED_MANIFEST_HEADER_SIZE,
                  Number(restingOrderInternal.traderIndex) +
                    48 +
                    FIXED_MANIFEST_HEADER_SIZE,
                ),
              )[0].publicKey,
              price: convertU128(restingOrderInternal.price),
            };
          })
        : [];

    const asks: RestingOrder[] =
      asksRootIndex != NIL
        ? deserializeRedBlackTree(
            data.subarray(FIXED_MANIFEST_HEADER_SIZE),
            asksRootIndex,
            restingOrderBeet,
          ).map((restingOrderInternal: RestingOrderInternal) => {
            return {
              ...restingOrderInternal,
              trader: publicKeyBeet.deserialize(
                data.subarray(
                  Number(restingOrderInternal.traderIndex) +
                    16 +
                    FIXED_MANIFEST_HEADER_SIZE,
                  Number(restingOrderInternal.traderIndex) +
                    48 +
                    FIXED_MANIFEST_HEADER_SIZE,
                ),
              )[0].publicKey,
              price: convertU128(restingOrderInternal.price),
            };
          })
        : [];

    const claimedSeats =
      claimedSeatsRootIndex != NIL
        ? deserializeRedBlackTree(
            data.subarray(FIXED_MANIFEST_HEADER_SIZE),
            claimedSeatsRootIndex,
            claimedSeatBeet,
          )
        : [];

    return {
      version,
      baseMintDecimals,
      quoteMintDecimals,
      baseMint,
      quoteMint,
      orderSequenceNumber,
      numBytesAllocated,
      bids,
      asks,
      claimedSeats,
    };
  }
}
