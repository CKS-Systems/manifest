import { bignum } from '@metaplex-foundation/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import { Connection, PublicKey } from '@solana/web3.js';
import { createPlaceOrderInstruction, OrderType } from './ui_wrapper';
import { marketInfoBeet, openOrderBeet } from './utils/beet';
import { deserializeRedBlackTree } from './utils/redBlackTree';
import {
  FIXED_WRAPPER_HEADER_SIZE,
  NIL,
  NO_EXPIRATION_LAST_VALID_SLOT,
  PRICE_MAX_EXP,
  PRICE_MIN_EXP,
  U32_MAX,
} from './constants';
import { PROGRAM_ID as MANIFEST_PROGRAM_ID } from './manifest';
import { Market } from './market';
import { getVaultAddress } from './utils/market';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

/**
 * All data stored on a wrapper account.
 */
export interface WrapperData {
  /** Public key for the owner of this wrapper. */
  owner: PublicKey;
  /** Array of market infos that have been parsed. */
  marketInfos: MarketInfoParsed[];
}

/**
 * Parsed market info on a wrapper. Accurate to the last sync.
 */
export interface MarketInfoParsed {
  /** Public key for market. */
  market: PublicKey;
  /** Base balance in atoms. */
  baseBalanceAtoms: bignum;
  /** Quote balance in atoms. */
  quoteBalanceAtoms: bignum;
  /** Open orders. */
  orders: OpenOrder[];
  /** Last update slot number. */
  lastUpdatedSlot: number;
}

/**
 * Raw market info on a wrapper.
 */
export interface MarketInfoRaw {
  market: PublicKey;
  openOrdersRootIndex: number;
  traderIndex: number;
  baseBalanceAtoms: bignum;
  quoteBalanceAtoms: bignum;
  quoteVolumeAtoms: bignum;
  lastUpdatedSlot: number;
  padding: number; // 3 bytes
}

/**
 * OpenOrder on a wrapper. Accurate as of the latest sync.
 */
export interface OpenOrder {
  /** Client order id used for cancelling orders. Does not need to be unique. */
  clientOrderId: bignum;
  /** Exchange defined id for an order. */
  orderSequenceNumber: bignum;
  /** Price as float in tokens of quote per tokens of base. */
  tokenPrice: number;
  /** Number of base tokens remaining in the order. */
  numBaseTokens: number;
  /** Hint for the location of the order in the manifest dynamic data. */
  dataIndex: number;
  /** Last slot before this order is invalid and will be removed. */
  lastValidSlot: number;
  /** Boolean for whether this order is on the bid side. */
  isBid: boolean;
  /** Type of order (Limit, PostOnly, ...). */
  orderType: OrderType;
}

export interface OpenOrderInternal {
  price: Uint8Array;
  clientOrderId: bignum;
  orderSequenceNumber: bignum;
  numBaseAtoms: bignum;
  dataIndex: number;
  lastValidSlot: number;
  isBid: boolean;
  orderType: number;
  padding: bignum[]; // 30 bytes
}

/**
 * Wrapper object used for reading data from a wrapper for manifest markets.
 */
export class UiWrapper {
  /** Public key for the market account. */
  private address: PublicKey;
  /** Deserialized data. */
  private data: WrapperData;
  /** Market reference for looking up decimals */
  private market: Market;

  /**
   * Constructs a Wrapper object.
   *
   * @param address The `PublicKey` of the wrapper account
   * @param data Deserialized wrapper data
   */
  private constructor(address: PublicKey, data: WrapperData, market: Market) {
    this.address = address;
    this.data = data;
    this.market = market;
  }

  /**
   * Returns a `Wrapper` for a given address, a data buffer
   *
   * @param marketAddress The `PublicKey` of the wrapper account
   * @param buffer The buffer holding the wrapper account data
   */
  static loadFromBuffer(
    address: PublicKey,
    buffer: Buffer,
    market: Market,
  ): UiWrapper {
    const wrapperData = UiWrapper.deserializeWrapperBuffer(market, buffer);
    return new UiWrapper(address, wrapperData, market);
  }

  /**
   * Updates the data in a Wrapper.
   *
   * @param connection The Solana `Connection` object
   */
  public async reload(connection: Connection): Promise<void> {
    const buffer = await connection
      .getAccountInfo(this.address)
      .then((accountInfo) => accountInfo?.data);
    if (buffer === undefined) {
      throw new Error(`Failed to load ${this.address}`);
    }
    await this.market.reload(connection);
    this.data = UiWrapper.deserializeWrapperBuffer(this.market, buffer);
  }

  /**
   * Get the parsed market info from the wrapper.
   *
   * @param marketPk PublicKey for the market
   *
   * @return MarketInfoParsed
   */
  public marketInfoForMarket(marketPk: PublicKey): MarketInfoParsed | null {
    const filtered: MarketInfoParsed[] = this.data.marketInfos.filter(
      (marketInfo: MarketInfoParsed) => {
        return marketInfo.market.toBase58() == marketPk.toBase58();
      },
    );
    if (filtered.length == 0) {
      return null;
    }
    return filtered[0];
  }

  /**
   * Get the open orders from the wrapper.
   *
   * @param marketPk PublicKey for the market
   *
   * @return OpenOrder[]
   */
  public openOrdersForMarket(marketPk: PublicKey): OpenOrder[] | null {
    const filtered: MarketInfoParsed[] = this.data.marketInfos.filter(
      (marketInfo: MarketInfoParsed) => {
        return marketInfo.market.toBase58() == marketPk.toBase58();
      },
    );
    if (filtered.length == 0) {
      return null;
    }
    return filtered[0].orders;
  }

  // Do not include getters for the balances because those can be retrieved from
  // the market and that will be fresher data or the same always.

  /**
   * Print all information loaded about the wrapper in a human readable format.
   */
  public prettyPrint() {
    console.log('');
    console.log(`Wrapper: ${this.address.toBase58()}`);
    console.log(`========================`);
    console.log(`Owner: ${this.data.owner.toBase58()}`);
    this.data.marketInfos.forEach((marketInfo: MarketInfoParsed) => {
      console.log(`------------------------`);
      console.log(`Market: ${marketInfo.market}`);
      console.log(`Last updated slot: ${marketInfo.lastUpdatedSlot}`);
      console.log(
        `BaseAtoms: ${marketInfo.baseBalanceAtoms} QuoteAtoms: ${marketInfo.quoteBalanceAtoms}`,
      );
      marketInfo.orders.forEach((order: OpenOrder) => {
        console.log(
          `OpenOrder: ClientOrderId: ${order.clientOrderId} ${order.numBaseTokens}@${order.tokenPrice} SeqNum: ${order.orderSequenceNumber} LastValidSlot: ${order.lastValidSlot} IsBid: ${order.isBid}`,
        );
      });
    });
    console.log(`------------------------`);
  }

  /**
   * Deserializes wrapper data from a given buffer and returns a `Wrapper` object
   *
   * This includes both the fixed and dynamic parts of the market.
   * https://github.com/CKS-Systems/manifest/blob/main/programs/wrapper/src/wrapper_state.rs
   *
   * @param data The data buffer to deserialize
   *
   * @returns WrapperData
   */
  public static deserializeWrapperBuffer(
    market: Market,
    data: Buffer,
  ): WrapperData {
    let offset = 0;
    // Deserialize the market header
    const _discriminant = data.readBigUInt64LE(0);
    offset += 8;

    const owner = beetPublicKey.read(data, offset);

    offset += beetPublicKey.byteSize;

    const _numBytesAllocated = data.readUInt32LE(offset);
    offset += 4;

    const _freeListHeadIndex = data.readUInt32LE(offset);
    offset += 4;

    const marketInfosRootIndex = data.readUInt32LE(offset);
    offset += 4;

    const _padding = data.readUInt32LE(offset);
    offset += 12;

    const marketInfos: MarketInfoRaw[] =
      marketInfosRootIndex != NIL
        ? deserializeRedBlackTree(
            data.subarray(FIXED_WRAPPER_HEADER_SIZE),
            marketInfosRootIndex,
            marketInfoBeet,
          )
        : [];

    const parsedMarketInfos: MarketInfoParsed[] = marketInfos.map(
      (marketInfoRaw: MarketInfoRaw) => {
        const rootIndex: number = marketInfoRaw.openOrdersRootIndex;
        const parsedOpenOrders: OpenOrderInternal[] =
          rootIndex != NIL
            ? deserializeRedBlackTree(
                data.subarray(FIXED_WRAPPER_HEADER_SIZE),
                rootIndex,
                openOrderBeet,
              )
            : [];

        const parsedOpenOrdersWithPrice: OpenOrder[] = parsedOpenOrders
          .map((orderOnWrapper: OpenOrderInternal) => {
            const orderOnBook = market.openOrders().find(
              (oo) =>
                // this is the easiery way to work around the absurd type union bignum
                oo.sequenceNumber.toString() ==
                orderOnWrapper.orderSequenceNumber.toString(),
            );
            if (!orderOnBook) {
              return null;
            } else {
              return {
                ...orderOnWrapper,
                ...orderOnBook,
              };
            }
          })
          .filter((o) => o != null);

        return {
          market: marketInfoRaw.market,
          baseBalanceAtoms: marketInfoRaw.baseBalanceAtoms,
          quoteBalanceAtoms: marketInfoRaw.quoteBalanceAtoms,
          orders: parsedOpenOrdersWithPrice,
          lastUpdatedSlot: marketInfoRaw.lastUpdatedSlot,
        };
      },
    );

    return {
      owner,
      marketInfos: parsedMarketInfos,
    };
  }

  public placeOrderIx(
    market: Market,
    accounts: { payer?: PublicKey },
    args: { isBid: boolean; amount: number; price: number; orderId?: number },
  ) {
    const { owner } = this.data;
    const payer = accounts.payer ?? owner;
    const { isBid } = args;
    const mint = isBid ? market.quoteMint() : market.baseMint();
    const traderTokenAccount = getAssociatedTokenAddressSync(mint, owner);
    const vault = getVaultAddress(market.address, mint);
    const clientOrderId = args.orderId ?? Date.now();
    const baseAtoms = Math.round(args.amount * 10 ** market.baseDecimals());
    let priceMantissa = args.price;
    let priceExponent = market.baseDecimals() - market.quoteDecimals();
    while (
      priceMantissa < U32_MAX / 10 &&
      priceExponent > PRICE_MIN_EXP &&
      Math.round(priceMantissa) != priceMantissa
    ) {
      priceMantissa *= 10;
      priceExponent -= 1;
    }
    while (priceMantissa > U32_MAX && priceExponent < PRICE_MAX_EXP) {
      priceMantissa = priceMantissa / 10;
      priceExponent += 1;
    }
    priceMantissa = Math.round(priceMantissa);

    return createPlaceOrderInstruction(
      {
        wrapperState: this.address,
        owner,
        traderTokenAccount,
        market: market.address,
        vault,
        mint,
        manifestProgram: MANIFEST_PROGRAM_ID,
        payer,
      },
      {
        params: {
          clientOrderId,
          baseAtoms,
          priceMantissa,
          priceExponent,
          isBid,
          lastValidSlot: NO_EXPIRATION_LAST_VALID_SLOT,
          orderType: OrderType.Limit,
        },
      },
    );
  }
}
