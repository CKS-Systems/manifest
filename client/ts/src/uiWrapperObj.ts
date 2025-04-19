import { bignum } from '@metaplex-foundation/beet';
import { publicKey as beetPublicKey } from '@metaplex-foundation/beet-solana';
import {
  AccountInfo,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createCreateWrapperInstruction,
  createPlaceOrderInstruction,
  createSettleFundsInstruction,
  OrderType,
  PROGRAM_ID,
  SettleFundsInstructionArgs,
  wrapperOpenOrderBeet as uiWrapperOpenOrderBeet,
  WrapperOpenOrder as UIWrapperOpenOrderRaw,
} from './ui_wrapper';
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
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { convertU128 } from './utils/numbers';
import { BN } from 'bn.js';
import { getGlobalAddress, getGlobalVaultAddress } from './utils/global';
import {
  MarketInfo as UiWrapperMarketInfoRaw,
  marketInfoBeet,
} from './ui_wrapper/types';

/**
 * All data stored on a wrapper account.
 */
export interface UiWrapperData {
  /** Public key for the owner of this wrapper. */
  owner: PublicKey;
  /** Array of market infos that have been parsed. */
  marketInfos: UiWrapperMarketInfo[];
}

/**
 * Parsed market info on a wrapper. Accurate to the last sync.
 */
export interface UiWrapperMarketInfo {
  /** Public key for market. */
  market: PublicKey;
  /** Base balance in atoms. */
  baseBalanceAtoms: bignum;
  /** Quote balance in atoms. */
  quoteBalanceAtoms: bignum;
  /** Open orders. */
  orders: UiWrapperOpenOrder[];
  /** Last update slot number. */
  lastUpdatedSlot: number;
}

/**
 * OpenOrder on a wrapper. Accurate as of the latest sync.
 */
export interface UiWrapperOpenOrder {
  /** Client order id used for cancelling orders. Does not need to be unique. */
  clientOrderId: bignum;
  /** Exchange defined id for an order. */
  orderSequenceNumber: bignum;
  /** Price as float in atoms of quote per atoms of base. */
  price: number;
  /** Number of base atoms in the order. */
  numBaseAtoms: bignum;
  /** Hint for the location of the order in the manifest dynamic data. */
  dataIndex: number;
  /** Last slot before this order is invalid and will be removed. */
  lastValidSlot: number;
  /** Boolean for whether this order is on the bid side. */
  isBid: boolean;
  /** Type of order (Limit, PostOnly, ...). */
  orderType: OrderType;
}

export interface UiWrapperOpenOrderRaw {
  price: Uint8Array;
  clientOrderId: bignum;
  orderSequenceNumber: bignum;
  numBaseAtoms: bignum;
  marketDataIndex: number;
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
  address: PublicKey;
  /** Deserialized data. */
  private data: UiWrapperData;

  /**
   * Constructs a Wrapper object.
   *
   * @param address The `PublicKey` of the wrapper account
   * @param data Deserialized wrapper data
   */
  private constructor({
    address,
    data,
  }: {
    address: PublicKey;
    data: UiWrapperData;
  }) {
    this.address = address;
    this.data = data;
  }

  /**
   * Returns a `Wrapper` for a given address, a data buffer
   *
   * @param marketAddress The `PublicKey` of the wrapper account
   * @param buffer The buffer holding the wrapper account data
   */
  static loadFromBuffer({
    address,
    buffer,
  }: {
    address: PublicKey;
    buffer: Buffer;
  }): UiWrapper {
    const wrapperData = UiWrapper.deserializeWrapperBuffer(buffer);
    return new UiWrapper({ address, data: wrapperData });
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
    this.data = UiWrapper.deserializeWrapperBuffer(buffer);
  }

  /**
   * Get the parsed market info from the wrapper.
   *
   * @param marketPk PublicKey for the market
   *
   * @return MarketInfoParsed
   */
  public marketInfoForMarket(marketPk: PublicKey): UiWrapperMarketInfo | null {
    const filtered: UiWrapperMarketInfo[] = this.data.marketInfos.filter(
      (marketInfo: UiWrapperMarketInfo) => {
        return marketInfo.market.equals(marketPk);
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
  public openOrdersForMarket(marketPk: PublicKey): UiWrapperOpenOrder[] | null {
    const filtered: UiWrapperMarketInfo[] = this.data.marketInfos.filter(
      (marketInfo: UiWrapperMarketInfo) => {
        return marketInfo.market.equals(marketPk);
      },
    );
    if (filtered.length == 0) {
      return null;
    }
    return filtered[0].orders;
  }

  public activeMarkets(): PublicKey[] {
    return this.data.marketInfos.map((mi) => mi.market);
  }

  public unsettledBalances(
    markets: Market[],
  ): { market: Market; numBaseTokens: number; numQuoteTokens: number }[] {
    const { owner } = this.data;
    return markets.map((market) => {
      const numBaseTokens = market.getWithdrawableBalanceTokens(owner, true);
      const numQuoteTokens = market.getWithdrawableBalanceTokens(owner, false);
      return { market, numBaseTokens, numQuoteTokens };
    });
  }

  public settleIx(
    market: Market,
    accounts: {
      platformTokenAccount: PublicKey;
      referrerTokenAccount: PublicKey;
      baseTokenProgram?: PublicKey;
      quoteTokenProgram?: PublicKey;
    },
    params: SettleFundsInstructionArgs,
  ): TransactionInstruction {
    const { owner } = this.data;
    const mintBase = market.baseMint();
    const mintQuote = market.quoteMint();
    const traderTokenAccountBase = getAssociatedTokenAddressSync(
      mintBase,
      owner,
    );
    const traderTokenAccountQuote = getAssociatedTokenAddressSync(
      mintQuote,
      owner,
    );

    const vaultBase = getVaultAddress(market.address, mintBase);
    const vaultQuote = getVaultAddress(market.address, mintQuote);

    return createSettleFundsInstruction(
      {
        wrapperState: this.address,
        owner,
        traderTokenAccountBase,
        traderTokenAccountQuote,
        market: market.address,
        vaultBase,
        vaultQuote,
        mintBase,
        mintQuote,
        tokenProgramBase: accounts.baseTokenProgram || TOKEN_PROGRAM_ID,
        tokenProgramQuote: accounts.quoteTokenProgram || TOKEN_PROGRAM_ID,
        manifestProgram: MANIFEST_PROGRAM_ID,
        platformTokenAccount: accounts.platformTokenAccount,
        referrerTokenAccount: accounts.referrerTokenAccount,
      },
      params,
    );
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
    this.data.marketInfos.forEach((marketInfo: UiWrapperMarketInfo) => {
      console.log(`------------------------`);
      console.log(`Market: ${marketInfo.market}`);
      console.log(`Last updated slot: ${marketInfo.lastUpdatedSlot}`);
      console.log(
        `BaseAtoms: ${marketInfo.baseBalanceAtoms} QuoteAtoms: ${marketInfo.quoteBalanceAtoms}`,
      );
      marketInfo.orders.forEach((order: UiWrapperOpenOrder) => {
        console.log(
          `OpenOrder: ClientOrderId: ${order.clientOrderId} ${order.numBaseAtoms}@${order.price} SeqNum: ${order.orderSequenceNumber} LastValidSlot: ${order.lastValidSlot} IsBid: ${order.isBid}`,
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
  public static deserializeWrapperBuffer(data: Buffer): UiWrapperData {
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

    const marketInfos: UiWrapperMarketInfoRaw[] =
      marketInfosRootIndex != NIL
        ? deserializeRedBlackTree(
            data.subarray(FIXED_WRAPPER_HEADER_SIZE),
            marketInfosRootIndex,
            marketInfoBeet,
          )
        : [];

    const parsedMarketInfos: UiWrapperMarketInfo[] = marketInfos.map(
      (marketInfoRaw: UiWrapperMarketInfoRaw) => {
        const rootIndex: number = marketInfoRaw.ordersRootIndex;
        const rawOpenOrders: UIWrapperOpenOrderRaw[] =
          rootIndex != NIL
            ? deserializeRedBlackTree(
                data.subarray(FIXED_WRAPPER_HEADER_SIZE),
                rootIndex,
                uiWrapperOpenOrderBeet,
              )
            : [];

        const parsedOpenOrdersWithPrice: UiWrapperOpenOrder[] =
          rawOpenOrders.map((openOrder: UIWrapperOpenOrderRaw) => {
            return {
              ...openOrder,
              dataIndex: openOrder.marketDataIndex,
              price: convertU128(new BN(openOrder.price, 10, 'le')),
            };
          });

        return {
          market: marketInfoRaw.market,
          baseBalanceAtoms: marketInfoRaw.baseBalance,
          quoteBalanceAtoms: marketInfoRaw.quoteBalance,
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
    accounts: {
      payer?: PublicKey;
      baseTokenProgram?: PublicKey;
      quoteTokenProgram?: PublicKey;
    },
    args: { isBid: boolean; amount: number; price: number; orderId?: number },
  ) {
    const { owner } = this.data;
    const payer = accounts.payer ?? owner;
    const { isBid } = args;
    const mint = isBid ? market.quoteMint() : market.baseMint();
    const traderTokenProgram = isBid
      ? accounts.quoteTokenProgram
      : accounts.baseTokenProgram;

    const traderTokenAccount = getAssociatedTokenAddressSync(
      mint,
      owner,
      true,
      traderTokenProgram,
    );
    const vault = getVaultAddress(market.address, mint);
    const clientOrderId = args.orderId || Date.now();
    const baseAtoms = Math.round(args.amount * 10 ** market.baseDecimals());
    let priceMantissa = args.price;
    let priceExponent = market.quoteDecimals() - market.baseDecimals();
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

    const baseGlobal: PublicKey = getGlobalAddress(market.baseMint());
    const quoteGlobal: PublicKey = getGlobalAddress(market.quoteMint());
    const baseGlobalVault: PublicKey = getGlobalVaultAddress(market.baseMint());
    const quoteGlobalVault: PublicKey = getGlobalVaultAddress(
      market.quoteMint(),
    );

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
        tokenProgram: traderTokenProgram,
        baseMint: market.baseMint(),
        baseGlobal,
        baseGlobalVault,
        baseMarketVault: getVaultAddress(market.address, market.baseMint()),
        baseTokenProgram: accounts.baseTokenProgram || TOKEN_PROGRAM_ID,
        quoteMint: market.quoteMint(),
        quoteGlobal,
        quoteGlobalVault,
        quoteMarketVault: getVaultAddress(market.address, market.quoteMint()),
        quoteTokenProgram: accounts.quoteTokenProgram || TOKEN_PROGRAM_ID,
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

  public static async fetchFirstUserWrapper(
    connection: Connection,
    payer: PublicKey,
  ): Promise<Readonly<{
    account: AccountInfo<Buffer>;
    pubkey: PublicKey;
  }> | null> {
    const existingWrappers = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        // Dont check discriminant since there is only one type of account.
        {
          memcmp: {
            offset: 8,
            encoding: 'base58',
            bytes: payer.toBase58(),
          },
        },
      ],
    });

    return existingWrappers.length > 0 ? existingWrappers[0] : null;
  }

  public static async placeOrderCreateIfNotExistsIxs(
    connection: Connection,
    baseMint: PublicKey,
    baseDecimals: number,
    quoteMint: PublicKey,
    quoteDecimals: number,
    owner: PublicKey,
    payer: PublicKey,
    args: { isBid: boolean; amount: number; price: number; orderId?: number },
    baseTokenProgram = TOKEN_PROGRAM_ID,
    quoteTokenProgram = TOKEN_PROGRAM_ID,
  ): Promise<{ ixs: TransactionInstruction[]; signers: Signer[] }> {
    const ixs: TransactionInstruction[] = [];
    const signers: Signer[] = [];

    const [markets, wrapper] = await Promise.all([
      Market.findByMints(connection, baseMint, quoteMint),
      UiWrapper.fetchFirstUserWrapper(connection, owner),
    ]);
    let market = markets.length > 0 ? markets[0] : null;
    let wrapperPk = wrapper?.pubkey;

    if (!market) {
      const marketIxs = await Market.setupIxs(
        connection,
        baseMint,
        quoteMint,
        payer,
      );
      market = {
        address: marketIxs.signers[0].publicKey,
        baseMint: () => baseMint,
        quoteMint: () => quoteMint,
        baseDecimals: () => baseDecimals,
        quoteDecimals: () => quoteDecimals,
      } as Market;

      ixs.push(...marketIxs.ixs);
      signers.push(...marketIxs.signers);
    }

    if (!wrapper) {
      const setup = await this.setupIxs(connection, owner, payer);
      wrapperPk = setup.signers[0].publicKey;

      ixs.push(...setup.ixs);
      signers.push(...setup.signers);
    }

    if (wrapper) {
      const wrapperParsed = UiWrapper.loadFromBuffer({
        address: wrapper.pubkey,
        buffer: wrapper.account.data,
      });
      const placeIx = wrapperParsed.placeOrderIx(
        market,
        { payer, baseTokenProgram, quoteTokenProgram },
        args,
      );
      ixs.push(placeIx);
    } else {
      const placeIx = await this.placeIx_(
        market,
        {
          wrapper: wrapperPk!,
          owner,
          payer,
          baseTokenProgram,
          quoteTokenProgram,
        },
        args,
      );
      ixs.push(...placeIx.ixs);
      signers.push(...placeIx.signers);
    }

    return {
      ixs,
      signers,
    };
  }

  public static async setupIxs(
    connection: Connection,
    owner: PublicKey,
    payer: PublicKey,
  ): Promise<{ ixs: TransactionInstruction[]; signers: Signer[] }> {
    const wrapperKeypair: Keypair = Keypair.generate();
    const createAccountIx: TransactionInstruction = SystemProgram.createAccount(
      {
        fromPubkey: payer,
        newAccountPubkey: wrapperKeypair.publicKey,
        space: FIXED_WRAPPER_HEADER_SIZE,
        lamports: await connection.getMinimumBalanceForRentExemption(
          FIXED_WRAPPER_HEADER_SIZE,
        ),
        programId: PROGRAM_ID,
      },
    );
    const createWrapperIx: TransactionInstruction =
      createCreateWrapperInstruction({
        payer,
        owner,
        wrapperState: wrapperKeypair.publicKey,
      });
    return {
      ixs: [createAccountIx, createWrapperIx],
      signers: [wrapperKeypair],
    };
  }

  private static placeIx_(
    market: {
      address: PublicKey;
      baseMint: () => PublicKey;
      quoteMint: () => PublicKey;
      baseDecimals: () => number;
      quoteDecimals: () => number;
    },
    accounts: {
      wrapper: PublicKey;
      owner: PublicKey;
      payer: PublicKey;
      baseTokenProgram?: PublicKey;
      quoteTokenProgram?: PublicKey;
    },
    args: { isBid: boolean; amount: number; price: number; orderId?: number },
  ): { ixs: TransactionInstruction[]; signers: Signer[] } {
    const { isBid } = args;
    const mint = isBid ? market.quoteMint() : market.baseMint();
    const traderTokenProgram = isBid
      ? accounts.quoteTokenProgram
      : accounts.baseTokenProgram;

    const traderTokenAccount = getAssociatedTokenAddressSync(
      mint,
      accounts.owner,
      true,
      traderTokenProgram,
    );
    const vault = getVaultAddress(market.address, mint);
    const clientOrderId = args.orderId || Date.now();
    const baseAtoms = Math.round(args.amount * 10 ** market.baseDecimals());
    let priceMantissa = args.price;
    let priceExponent = market.quoteDecimals() - market.baseDecimals();
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

    const baseMarketVault: PublicKey = getVaultAddress(
      market.address,
      market.baseMint(),
    );
    const quoteMarketVault: PublicKey = getVaultAddress(
      market.address,
      market.quoteMint(),
    );
    const baseGlobal: PublicKey = getGlobalAddress(market.baseMint());
    const quoteGlobal: PublicKey = getGlobalAddress(market.quoteMint());
    const baseGlobalVault: PublicKey = getGlobalVaultAddress(market.baseMint());
    const quoteGlobalVault: PublicKey = getGlobalVaultAddress(
      market.quoteMint(),
    );

    const placeIx = createPlaceOrderInstruction(
      {
        wrapperState: accounts.wrapper,
        owner: accounts.owner,
        traderTokenAccount,
        market: market.address,
        vault,
        mint,
        manifestProgram: MANIFEST_PROGRAM_ID,
        payer: accounts.payer,
        baseMint: market.baseMint(),
        baseGlobal,
        baseGlobalVault,
        baseMarketVault,
        tokenProgram: traderTokenProgram,
        baseTokenProgram: accounts.baseTokenProgram || TOKEN_PROGRAM_ID,
        quoteMint: market.quoteMint(),
        quoteGlobal,
        quoteGlobalVault,
        quoteMarketVault,
        quoteTokenProgram: accounts.quoteTokenProgram || TOKEN_PROGRAM_ID,
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

    return { ixs: [placeIx], signers: [] };
  }
}
