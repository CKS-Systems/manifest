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
  TransactionSignature,
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
   * @param amountTokens Number of tokens to deposit.
   *
   * @returns TransactionInstruction
   */
  public depositIx(
    payer: PublicKey,
    mint: PublicKey,
    amountTokens: number,
  ): TransactionInstruction {
    const vault: PublicKey = getVaultAddress(this.market.address, mint);
    const traderTokenAccount: PublicKey = getAssociatedTokenAddressSync(
      mint,
      payer,
    );
    const is22: boolean =
      (mint == this.baseMint.address && this.isBase22) ||
      (mint == this.baseMint.address && this.isBase22);
    const mintDecimals =
      this.market.quoteMint().toBase58() === mint.toBase58()
        ? this.market.quoteDecimals()
        : this.market.baseDecimals();
    const amountAtoms = Math.ceil(amountTokens * 10 ** mintDecimals);

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
   * @param mint PublicKey for withdraw mint. Must be either the base or quote
   * @param amountTokens Number of tokens to withdraw.
   *
   * @returns TransactionInstruction
   */
  public withdrawIx(
    payer: PublicKey,
    mint: PublicKey,
    amountTokens: number,
  ): TransactionInstruction {
    const vault: PublicKey = getVaultAddress(this.market.address, mint);
    const traderTokenAccount: PublicKey = getAssociatedTokenAddressSync(
      mint,
      payer,
    );
    const is22: boolean =
      (mint == this.baseMint.address && this.isBase22) ||
      (mint == this.baseMint.address && this.isBase22);
    const mintDecimals =
      this.market.quoteMint().toBase58() === mint.toBase58()
        ? this.market.quoteDecimals()
        : this.market.baseDecimals();
    const amountAtoms = Math.floor(amountTokens * 10 ** mintDecimals);

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
   * Withdraw All instruction. Withdraws all available base and quote tokens
   *
   * @returns TransactionInstruction[]
   */
  public withdrawAllIx(): TransactionInstruction[] {
    const withdrawInstructions: TransactionInstruction[] = [];

    const baseBalance = this.market.getWithdrawableBalanceTokens(
      this.payer,
      true,
    );
    if (baseBalance > 0) {
      const baseWithdrawIx = this.withdrawIx(
        this.payer,
        this.market.baseMint(),
        baseBalance,
      );
      withdrawInstructions.push(baseWithdrawIx);
    }

    const quoteBalance = this.market.getWithdrawableBalanceTokens(
      this.payer,
      false,
    );
    if (quoteBalance > 0) {
      const quoteWithdrawIx = this.withdrawIx(
        this.payer,
        this.market.quoteMint(),
        quoteBalance,
      );
      withdrawInstructions.push(quoteWithdrawIx);
    }

    return withdrawInstructions;
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
   * PlaceOrderWithRequiredDeposit instruction. Only deposits the appropriate base
   * or quote tokens if not in the withdrawable balances.
   *
   * @param payer PublicKey of the trader
   * @param params PlaceOrderParamsExternal including all the information for
   * placing an order like amount, price, ordertype, ... This is called external
   * because to avoid conflicts with the autogenerated version which has
   * problems with expressing some of the parameters.
   *
   * @returns TransactionInstruction[]
   */
  public placeOrderWithRequiredDepositIx(
    payer: PublicKey,
    params: WrapperPlaceOrderParamsExternal,
  ): TransactionInstruction[] {
    const placeOrderIx = this.placeOrderIx(params);

    const currentBalance = this.market.getWithdrawableBalanceTokens(
      payer,
      !params.isBid,
    );
    let depositMint = this.market.baseMint();
    let depositAmount = params.numBaseTokens - currentBalance;

    if (params.isBid) {
      depositMint = this.market.quoteMint();
      depositAmount = params.numBaseTokens * params.tokenPrice - currentBalance;
    }

    if (depositAmount <= 0) {
      console.log('Enough balance to place order without deposit');
      return [placeOrderIx];
    }
    const depositIx = this.depositIx(payer, depositMint, depositAmount);

    return [depositIx, placeOrderIx];
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

  /**
   * CancelAll instruction. Cancels all orders on a market
   *
   * @returns TransactionInstruction
   */
  public cancelAllIx(): TransactionInstruction {
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
          cancelAll: true,
          orders: [],
          traderIndexHint: null,
        },
      },
    );
  }

  /**
   * ClearOutMarketTxs transactions. Pulls all orders
   * and withdraws all balances from the market in two transactions
   *
   * @param payer PublicKey of the trader
   *
   * @returns TransactionSignatures[]
   */
  public async clearOutMarketTxs(
    payerKeypair: Keypair,
  ): Promise<TransactionSignature[]> {
    await this.market.reload(this.connection);
    const cancelAllIx = this.cancelAllIx();
    const cancelAllTx = new Transaction();
    const cancelAllSig = await sendAndConfirmTransaction(
      this.connection,
      cancelAllTx.add(cancelAllIx),
      [payerKeypair],
      {
        commitment: 'confirmed',
      },
    );
    await this.market.reload(this.connection);
    const withdrawAllIx = this.withdrawAllIx();
    const withdrawAllTx = new Transaction();
    const wihdrawAllSig = await sendAndConfirmTransaction(
      this.connection,
      withdrawAllTx.add(...withdrawAllIx),
      [payerKeypair],
      {
        commitment: 'confirmed',
      },
    );
    return [cancelAllSig, wihdrawAllSig];
  }
}

/**
 * Same as the autogenerated WrapperPlaceOrderParams except price here is a number.
 */
export type WrapperPlaceOrderParamsExternal = {
  /** Number of base tokens in the order. */
  numBaseTokens: number;
  /** Price as float in quote tokens per base tokens. */
  tokenPrice: number;
  /** Boolean for whether this order is on the bid side. */
  isBid: boolean;
  /** Last slot before this order is invalid and will be removed. */
  lastValidSlot: number;
  /** Type of order (Limit, PostOnly, ...). */
  orderType: OrderType;
  /** Used in fill or kill orders. Set to zero otherwise. */
  minOutTokens?: number;
  /** Client order id used for cancelling orders. Does not need to be unique. */
  clientOrderId: bignum;
};

function toWrapperPlaceOrderParams(
  market: Market,
  wrapperPlaceOrderParamsExternal: WrapperPlaceOrderParamsExternal,
): WrapperPlaceOrderParams {
  const quoteAtomsPerToken = 10 ** market.quoteDecimals();
  const baseAtomsPerToken = 10 ** market.baseDecimals();
  // Converts token price to atom price since not always equal
  // Ex. BONK/USDC = 0.00001854 USDC tokens/BONK tokens -> 0.0001854 USDC Atoms/BONK Atoms
  const priceQuoteAtomsPerBaseAtoms =
    wrapperPlaceOrderParamsExternal.tokenPrice *
    (quoteAtomsPerToken / baseAtomsPerToken);
  // TODO: Make a helper and test it for this logic.
  const { priceMantissa, priceExponent } = toMantissaAndExponent(
    priceQuoteAtomsPerBaseAtoms,
  );
  const numBaseAtoms: bignum = Math.floor(
    wrapperPlaceOrderParamsExternal.numBaseTokens * baseAtomsPerToken,
  );

  const minOutTokens = wrapperPlaceOrderParamsExternal.minOutTokens ?? 0;

  const minOutAtoms = wrapperPlaceOrderParamsExternal.isBid
    ? Math.floor(minOutTokens * baseAtomsPerToken)
    : Math.floor(minOutTokens * quoteAtomsPerToken);

  return {
    ...wrapperPlaceOrderParamsExternal,
    baseAtoms: numBaseAtoms,
    priceMantissa,
    priceExponent,
    minOutAtoms,
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
