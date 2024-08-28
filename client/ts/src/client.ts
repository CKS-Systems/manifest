import { bignum } from '@metaplex-foundation/beet';
import {
  PublicKey,
  Connection,
  Keypair,
  TransactionInstruction,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  GetProgramAccountsResponse,
  AccountInfo,
} from '@solana/web3.js';
import {
  Mint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import {
  createCreateMarketInstruction,
  createSwapInstruction,
} from './manifest/instructions';
import { OrderType, SwapParams } from './manifest/types';
import { Market } from './market';
import { MarketInfoParsed, Wrapper, WrapperData } from './wrapperObj';
import { PROGRAM_ID as MANIFEST_PROGRAM_ID } from './manifest';
import {
  PROGRAM_ID as WRAPPER_PROGRAM_ID,
  WrapperCancelOrderParams,
  WrapperPlaceOrderParams,
  createBatchUpdateInstruction,
  createClaimSeatInstruction,
  createCreateWrapperInstruction,
  createDepositInstruction,
  createWithdrawInstruction,
} from './wrapper';
import { FIXED_WRAPPER_HEADER_SIZE } from './constants';
import { getVaultAddress } from './utils/market';

export class ManifestClient {
  private isBase22: boolean;
  private isQuote22: boolean;
  private constructor(
    public connection: Connection,
    public wrapper: Wrapper,
    public market: Market,
    private payer: PublicKey,
    private baseMint: Mint,
    private quoteMint: Mint,
  ) {
    this.isBase22 = baseMint.tlvData.length > 0;
    this.isQuote22 = quoteMint.tlvData.length > 0;
  }

  /**
   * Create a new client which creates a wrapper and claims seat if needed.
   *
   * @param connection Connection
   * @param marketPk PublicKey of the market
   * @param payerKeypair Keypair of the trader
   *
   * @returns ManifestClient
   */
  public static async getClientForMarket(
    connection: Connection,
    marketPk: PublicKey,
    payerKeypair: Keypair,
  ): Promise<ManifestClient> {
    const marketObject: Market = await Market.loadFromAddress({
      connection: connection,
      address: marketPk,
    });
    const baseMintPk: PublicKey = marketObject.baseMint();
    const quoteMintPk: PublicKey = marketObject.quoteMint();
    const baseMint: Mint = await getMint(connection, baseMintPk);
    const quoteMint: Mint = await getMint(connection, quoteMintPk);

    const existingWrappers: GetProgramAccountsResponse =
      await connection.getProgramAccounts(WRAPPER_PROGRAM_ID, {
        filters: [
          // Dont check discriminant since there is only one type of account.
          {
            memcmp: {
              offset: 8,
              encoding: 'base58',
              bytes: payerKeypair.publicKey.toBase58(),
            },
          },
        ],
      });
    const transaction: Transaction = new Transaction();
    if (existingWrappers.length == 0) {
      const wrapperKeypair: Keypair = Keypair.generate();
      const createAccountIx: TransactionInstruction =
        SystemProgram.createAccount({
          fromPubkey: payerKeypair.publicKey,
          newAccountPubkey: wrapperKeypair.publicKey,
          space: FIXED_WRAPPER_HEADER_SIZE,
          lamports: await connection.getMinimumBalanceForRentExemption(
            FIXED_WRAPPER_HEADER_SIZE,
          ),
          programId: WRAPPER_PROGRAM_ID,
        });
      const createWrapperIx: TransactionInstruction =
        createCreateWrapperInstruction({
          owner: payerKeypair.publicKey,
          payer: payerKeypair.publicKey,
          wrapperState: wrapperKeypair.publicKey,
        });
      const claimSeatIx: TransactionInstruction = createClaimSeatInstruction({
        manifestProgram: MANIFEST_PROGRAM_ID,
        owner: payerKeypair.publicKey,
        market: marketPk,
        payer: payerKeypair.publicKey,
        wrapperState: wrapperKeypair.publicKey,
      });
      transaction.add(createAccountIx);
      transaction.add(createWrapperIx);
      transaction.add(claimSeatIx);

      await sendAndConfirmTransaction(
        connection,
        transaction,
        [payerKeypair, wrapperKeypair],
        {
          commitment: 'finalized',
        },
      );
      const wrapper = await Wrapper.loadFromAddress({
        connection,
        address: wrapperKeypair.publicKey,
      });

      return new ManifestClient(
        connection,
        wrapper,
        marketObject,
        payerKeypair.publicKey,
        baseMint,
        quoteMint,
      );
    }

    const wrapperResponse: Readonly<{
      account: AccountInfo<Buffer>;
      pubkey: PublicKey;
    }> = existingWrappers[0];
    // Otherwise there is an existing wrapper
    const wrapperData: WrapperData = Wrapper.deserializeWrapperBuffer(
      wrapperResponse.account.data,
    );
    const existingMarketInfos: MarketInfoParsed[] =
      wrapperData.marketInfos.filter((marketInfo: MarketInfoParsed) => {
        return marketInfo.market.toBase58() == marketPk.toBase58();
      });
    if (existingMarketInfos.length > 0) {
      const wrapper = await Wrapper.loadFromAddress({
        connection,
        address: wrapperResponse.pubkey,
      });
      return new ManifestClient(
        connection,
        wrapper,
        marketObject,
        payerKeypair.publicKey,
        baseMint,
        quoteMint,
      );
    }

    // There is a wrapper, but need to claim a seat.
    const claimSeatIx: TransactionInstruction = createClaimSeatInstruction({
      manifestProgram: MANIFEST_PROGRAM_ID,
      owner: payerKeypair.publicKey,
      market: marketPk,
      payer: payerKeypair.publicKey,
      wrapperState: wrapperResponse.pubkey,
    });
    transaction.add(claimSeatIx);
    await sendAndConfirmTransaction(connection, transaction, [payerKeypair]);
    const wrapper = await Wrapper.loadFromAddress({
      connection,
      address: wrapperResponse.pubkey,
    });
    return new ManifestClient(
      connection,
      wrapper,
      marketObject,
      payerKeypair.publicKey,
      baseMint,
      quoteMint,
    );
  }

  /**
   * Reload the market and wrapper objects.
   */
  public async reload(): Promise<void> {
    await Promise.all([
      this.wrapper.reload(this.connection),
      this.market.reload(this.connection),
    ]);
  }

  /**
   * CreateMarket instruction. Assumes the account is already funded onchain.
   *
   * @param payer PublicKey of the trader
   * @param baseMint PublicKey of the baseMint
   * @param quoteMint PublicKey of the quoteMint
   * @param market PublicKey of the market that will be created. Private key
   *               will need to be a signer.
   *
   * @returns TransactionInstruction
   */
  private static createMarketIx(
    payer: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    market: PublicKey,
  ): TransactionInstruction {
    const baseVault: PublicKey = getVaultAddress(market, baseMint);
    const quoteVault: PublicKey = getVaultAddress(market, quoteMint);
    return createCreateMarketInstruction({
      payer,
      market,
      baseVault,
      quoteVault,
      baseMint,
      quoteMint,
      tokenProgram22: TOKEN_2022_PROGRAM_ID,
    });
  }

  /**
   * Deposit instruction
   *
   * @param payer PublicKey of the trader
   * @param mint PublicKey for deposit mint. Must be either the base or quote
   * @param amountAtoms Number of atoms to deposit.
   *
   * @returns TransactionInstruction
   */
  public depositIx(
    payer: PublicKey,
    mint: PublicKey,
    amountAtoms: number,
  ): TransactionInstruction {
    const vault: PublicKey = getVaultAddress(this.market.address, mint);
    const traderTokenAccount: PublicKey = getAssociatedTokenAddressSync(
      mint,
      payer,
    );
    const is22: boolean =
      (mint == this.baseMint.address && this.isBase22) ||
      (mint == this.baseMint.address && this.isBase22);

    return createDepositInstruction(
      {
        payer,
        market: this.market.address,
        traderTokenAccount,
        vault,
        manifestProgram: MANIFEST_PROGRAM_ID,
        owner: this.payer,
        wrapperState: this.wrapper.address,
        mint,
        tokenProgram: is22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      },
      {
        params: {
          amountAtoms,
        },
      },
    );
  }

  /**
   * Withdraw instruction
   *
   * @param payer PublicKey of the trader
   * @param market PublicKey of the market
   * @param mint PublicKey for withdraw mint. Must be either the base or quote
   * @param amountAtoms Number of atoms to withdraw.
   *
   * @returns TransactionInstruction
   */
  public withdrawIx(
    payer: PublicKey,
    mint: PublicKey,
    amountAtoms: number,
  ): TransactionInstruction {
    const vault: PublicKey = getVaultAddress(this.market.address, mint);
    const traderTokenAccount: PublicKey = getAssociatedTokenAddressSync(
      mint,
      payer,
    );
    const is22: boolean =
      (mint == this.baseMint.address && this.isBase22) ||
      (mint == this.baseMint.address && this.isBase22);

    return createWithdrawInstruction(
      {
        payer,
        market: this.market.address,
        traderTokenAccount,
        vault,
        manifestProgram: MANIFEST_PROGRAM_ID,
        owner: this.payer,
        wrapperState: this.wrapper.address,
        mint,
        tokenProgram: is22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      },
      {
        params: {
          amountAtoms,
        },
      },
    );
  }

  /**
   * PlaceOrder instruction
   *
   * @param params PlaceOrderParamsExternal including all the information for
   * placing an order like amount, price, ordertype, ... This is called external
   * because to avoid conflicts with the autogenerated version which has
   * problems with expressing some of the parameters.
   *
   * @returns TransactionInstruction
   */
  public placeOrderIx(
    params: WrapperPlaceOrderParamsExternal,
  ): TransactionInstruction {
    return createBatchUpdateInstruction(
      {
        payer: this.payer,
        market: this.market.address,
        manifestProgram: MANIFEST_PROGRAM_ID,
        owner: this.payer,
        wrapperState: this.wrapper.address,
      },
      {
        params: {
          cancels: [],
          cancelAll: false,
          orders: [toWrapperPlaceOrderParams(this.market, params)],
          traderIndexHint: null,
        },
      },
    );
  }

  /**
   * Swap instruction
   *
   * Optimized swap for routers and arb bots. Normal traders should compose
   * depost/withdraw/placeOrder to get limit orders. Does not go through the
   * wrapper.
   *
   * @param payer PublicKey of the trader
   * @param params SwapParams
   *
   * @returns TransactionInstruction
   */
  public swapIx(payer: PublicKey, params: SwapParams): TransactionInstruction {
    const traderBase: PublicKey = getAssociatedTokenAddressSync(
      this.baseMint.address,
      payer,
    );
    const traderQuote: PublicKey = getAssociatedTokenAddressSync(
      this.quoteMint.address,
      payer,
    );
    const baseVault: PublicKey = getVaultAddress(
      this.market.address,
      this.baseMint.address,
    );
    const quoteVault: PublicKey = getVaultAddress(
      this.market.address,
      this.quoteMint.address,
    );
    // Assumes just normal token program for now.
    // No Token22 support here in sdk yet.
    return createSwapInstruction(
      {
        payer,
        market: this.market.address,
        traderBase,
        traderQuote,
        baseVault,
        quoteVault,
        tokenProgramBase: this.isBase22
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID,
        baseMint: this.baseMint.address,
        tokenProgramQuote: this.isQuote22
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID,
        quoteMint: this.quoteMint.address,
      },
      {
        params,
      },
    );
  }

  /**
   * CancelOrder instruction
   *
   * @param params CancelOrderParams includes the orderSequenceNumber of the
   * order to cancel.
   *
   * @returns TransactionInstruction
   */
  public cancelOrderIx(
    params: WrapperCancelOrderParams,
  ): TransactionInstruction {
    return createBatchUpdateInstruction(
      {
        payer: this.payer,
        market: this.market.address,
        manifestProgram: MANIFEST_PROGRAM_ID,
        owner: this.payer,
        wrapperState: this.wrapper.address,
      },
      {
        params: {
          cancels: [params],
          cancelAll: false,
          orders: [],
          traderIndexHint: null,
        },
      },
    );
  }

  /**
   * BatchUpdate instruction
   *
   * @param params CancelOrderParams includes the orderSequenceNumber of the
   * order to cancel.
   *
   * @returns TransactionInstruction
   */
  public batchUpdateIx(
    placeParams: WrapperPlaceOrderParamsExternal[],
    cancelParams: WrapperCancelOrderParams[],
    cancelAll: boolean,
  ): TransactionInstruction {
    return createBatchUpdateInstruction(
      {
        payer: this.payer,
        market: this.market.address,
        manifestProgram: MANIFEST_PROGRAM_ID,
        owner: this.payer,
        wrapperState: this.wrapper.address,
      },
      {
        params: {
          cancels: cancelParams,
          cancelAll,
          orders: placeParams.map((params: WrapperPlaceOrderParamsExternal) =>
            toWrapperPlaceOrderParams(this.market, params),
          ),
          traderIndexHint: null,
        },
      },
    );
  }
}

/**
 * Same as the autogenerated WrapperPlaceOrderParams except price here is a number.
 */
export type WrapperPlaceOrderParamsExternal = {
  /** Number of base tokens in the order. */
  numBaseTokens: number;
  /** Price as float in quote tokens per base tokens. */
  price: number;
  /** Boolean for whether this order is on the bid side. */
  isBid: boolean;
  /** Last slot before this order is invalid and will be removed. */
  lastValidSlot: number;
  /** Type of order (Limit, PostOnly, ...). */
  orderType: OrderType;
  /** Used in fill or kill orders. Set to zero otherwise. */
  minOutAtoms?: bignum;
  /** Client order id used for cancelling orders. Does not need to be unique. */
  clientOrderId: bignum;
};

function toWrapperPlaceOrderParams(
  market: Market,
  wrapperPlaceOrderParamsExternal: WrapperPlaceOrderParamsExternal,
): WrapperPlaceOrderParams {
  const quoteAtoms = 10 ** market.quoteDecimals();
  const baseAtoms = 10 ** market.baseDecimals();
  // Converts token price to atom price since not always equal
  // Ex. BONK/USDC = 0.00001854 USDC tokens/BONK tokens -> 0.0001854 USDC Atoms/BONK Atoms
  const priceQuoteAtomsPerBaseAtoms =
    wrapperPlaceOrderParamsExternal.price * (quoteAtoms / baseAtoms);
  // TODO: Make a helper and test it for this logic.
  const { priceMantissa, priceExponent } = toMantissaAndExponent(
    priceQuoteAtomsPerBaseAtoms,
  );
  const numBaseAtoms: bignum =
    wrapperPlaceOrderParamsExternal.numBaseTokens * baseAtoms;

  return {
    ...wrapperPlaceOrderParamsExternal,
    baseAtoms: numBaseAtoms,
    priceMantissa,
    priceExponent,
    minOutAtoms: wrapperPlaceOrderParamsExternal.minOutAtoms ?? 0,
  };
}

export function toMantissaAndExponent(input: number): {
  priceMantissa: number;
  priceExponent: number;
} {
  let priceExponent = 0;
  let priceMantissa = input;
  const uInt32Max = 4_294_967_296;
  while (priceExponent > -20 && priceMantissa < uInt32Max / 100) {
    priceExponent -= 1;
    priceMantissa *= 10;
  }
  priceMantissa = Math.floor(priceMantissa);

  return {
    priceMantissa,
    priceExponent,
  };
}
