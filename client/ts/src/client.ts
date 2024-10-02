import { bignum } from '@metaplex-foundation/beet';
import {
  PublicKey,
  Connection,
  Keypair,
  TransactionInstruction,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
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
  createGlobalAddTraderInstruction,
  createGlobalCreateInstruction,
  createGlobalDepositInstruction,
  createGlobalWithdrawInstruction,
  createSwapInstruction,
} from './manifest/instructions';
import { OrderType, SwapParams } from './manifest/types';
import { Market } from './market';
import { MarketInfoParsed, Wrapper, WrapperData } from './wrapperObj';
import { PROGRAM_ID as MANIFEST_PROGRAM_ID, PROGRAM_ID } from './manifest';
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
import { getGlobalAddress, getGlobalVaultAddress } from './utils/global';

export interface SetupData {
  setupNeeded: boolean;
  instructions: TransactionInstruction[];
  wrapperKeypair: Keypair | null;
}

type WrapperResponse = Readonly<{
  account: AccountInfo<Buffer>;
  pubkey: PublicKey;
}>;

// TODO: compute this rather than hardcode
export const marketDiscriminator: string = 'hFwv1prLTHL';

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
    // If no extension data then the mint is not Token2022
    this.isBase22 = baseMint.tlvData.length > 0;
    this.isQuote22 = quoteMint.tlvData.length > 0;
  }

  /**
   * fetches all user wrapper accounts and returns the first or null if none are found
   *
   * @param connection Connection
   * @param payerPub PublicKey of the trader
   *
   * @returns Promise<GetProgramAccountsResponse>
   */
  private static async fetchFirstUserWrapper(
    connection: Connection,
    payerPub: PublicKey,
  ): Promise<WrapperResponse | null> {
    const existingWrappers = await connection.getProgramAccounts(
      WRAPPER_PROGRAM_ID,
      {
        filters: [
          // Dont check discriminant since there is only one type of account.
          {
            memcmp: {
              offset: 8,
              encoding: 'base58',
              bytes: payerPub.toBase58(),
            },
          },
        ],
      },
    );

    return existingWrappers.length > 0 ? existingWrappers[0] : null;
  }

  /**
   * list all Manifest markets using getProgramAccounts. caution: this is a heavy call.
   *
   * @param connection Connection
   * @returns PublicKey[]
   */
  public static async listMarketPublicKeys(
    connection: Connection,
  ): Promise<PublicKey[]> {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: marketDiscriminator } }],
    });

    return accounts.map((a) => a.pubkey);
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

    const userWrapper = await ManifestClient.fetchFirstUserWrapper(
      connection,
      payerKeypair.publicKey,
    );
    const transaction: Transaction = new Transaction();
    if (!userWrapper) {
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
          wrapperState: wrapperKeypair.publicKey,
        });
      const claimSeatIx: TransactionInstruction = createClaimSeatInstruction({
        manifestProgram: MANIFEST_PROGRAM_ID,
        owner: payerKeypair.publicKey,
        market: marketPk,
        wrapperState: wrapperKeypair.publicKey,
      });
      transaction.add(createAccountIx);
      transaction.add(createWrapperIx);
      transaction.add(claimSeatIx);

      await sendAndConfirmTransaction(connection, transaction, [
        payerKeypair,
        wrapperKeypair,
      ]);
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

    // Otherwise there is an existing wrapper
    const wrapperData: WrapperData = Wrapper.deserializeWrapperBuffer(
      userWrapper.account.data,
    );
    const existingMarketInfos: MarketInfoParsed[] =
      wrapperData.marketInfos.filter((marketInfo: MarketInfoParsed) => {
        return marketInfo.market.toBase58() == marketPk.toBase58();
      });
    if (existingMarketInfos.length > 0) {
      const wrapper = await Wrapper.loadFromAddress({
        connection,
        address: userWrapper.pubkey,
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
      wrapperState: userWrapper.pubkey,
    });
    transaction.add(claimSeatIx);
    await sendAndConfirmTransaction(connection, transaction, [payerKeypair]);
    const wrapper = await Wrapper.loadFromAddress({
      connection,
      address: userWrapper.pubkey,
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
   * generate ixs which need to be executed in order to run a manifest client for a given market. `{ setupNeeded: false }` means all good.
   * this function should be used before getClientForMarketNoPrivateKey for UI cases where `Keypair`s cannot be directly passed in.
   *
   * @param connection Connection
   * @param marketPk PublicKey of the market
   * @param payerKeypair Keypair of the trader
   *
   * @returns Promise<SetupData>
   */
  public static async getSetupIxs(
    connection: Connection,
    marketPk: PublicKey,
    payerPub: PublicKey,
  ): Promise<SetupData> {
    const setupData: SetupData = {
      setupNeeded: true,
      instructions: [],
      wrapperKeypair: null,
    };
    const userWrapper = await ManifestClient.fetchFirstUserWrapper(
      connection,
      payerPub,
    );
    if (!userWrapper) {
      const wrapperKeypair: Keypair = Keypair.generate();
      setupData.wrapperKeypair = wrapperKeypair;

      const createAccountIx: TransactionInstruction =
        SystemProgram.createAccount({
          fromPubkey: payerPub,
          newAccountPubkey: wrapperKeypair.publicKey,
          space: FIXED_WRAPPER_HEADER_SIZE,
          lamports: await connection.getMinimumBalanceForRentExemption(
            FIXED_WRAPPER_HEADER_SIZE,
          ),
          programId: WRAPPER_PROGRAM_ID,
        });
      setupData.instructions.push(createAccountIx);

      const createWrapperIx: TransactionInstruction =
        createCreateWrapperInstruction({
          owner: payerPub,
          wrapperState: wrapperKeypair.publicKey,
        });
      setupData.instructions.push(createWrapperIx);

      const claimSeatIx: TransactionInstruction = createClaimSeatInstruction({
        manifestProgram: MANIFEST_PROGRAM_ID,
        owner: payerPub,
        market: marketPk,
        wrapperState: wrapperKeypair.publicKey,
      });
      setupData.instructions.push(claimSeatIx);

      return setupData;
    }

    const wrapperData: WrapperData = Wrapper.deserializeWrapperBuffer(
      userWrapper.account.data,
    );

    const existingMarketInfos: MarketInfoParsed[] =
      wrapperData.marketInfos.filter((marketInfo: MarketInfoParsed) => {
        return marketInfo.market.toBase58() == marketPk.toBase58();
      });
    if (existingMarketInfos.length > 0) {
      setupData.setupNeeded = false;
      return setupData;
    }

    // There is a wrapper, but need to claim a seat.
    const claimSeatIx: TransactionInstruction = createClaimSeatInstruction({
      manifestProgram: MANIFEST_PROGRAM_ID,
      owner: payerPub,
      market: marketPk,
      wrapperState: userWrapper.pubkey,
    });
    setupData.instructions.push(claimSeatIx);

    return setupData;
  }

  /**
   * Create a new client. throws if setup ixs are needed. Call ManifestClient.getSetupIxs to check if ixs are needed.
   * This is the way to create a client without directly passing in `Keypair` types (for example when building a UI).
   *
   * @param connection Connection
   * @param marketPk PublicKey of the market
   * @param payerKeypair Keypair of the trader
   *
   * @returns ManifestClient
   */
  public static async getClientForMarketNoPrivateKey(
    connection: Connection,
    marketPk: PublicKey,
    payerPub: PublicKey,
  ): Promise<ManifestClient> {
    const { setupNeeded } = await this.getSetupIxs(
      connection,
      marketPk,
      payerPub,
    );
    if (setupNeeded) {
      throw new Error('setup ixs need to be executed first');
    }

    const marketObject: Market = await Market.loadFromAddress({
      connection: connection,
      address: marketPk,
    });
    const baseMintPk: PublicKey = marketObject.baseMint();
    const quoteMintPk: PublicKey = marketObject.quoteMint();
    const baseMint: Mint = await getMint(connection, baseMintPk);
    const quoteMint: Mint = await getMint(connection, quoteMintPk);

    const userWrapper = await ManifestClient.fetchFirstUserWrapper(
      connection,
      payerPub,
    );

    if (!userWrapper) {
      throw new Error(
        'userWrapper is null even though setupNeeded is false. This should never happen.',
      );
    }

    const wrapper = await Wrapper.loadFromAddress({
      connection,
      address: userWrapper.pubkey,
    });

    return new ManifestClient(
      connection,
      wrapper,
      marketObject,
      payerPub,
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
  public static createMarketIx(
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
      (mint.equals(this.baseMint.address) && this.isBase22) ||
      (mint.equals(this.quoteMint.address) && this.isQuote22);
    const mintDecimals =
      this.market.quoteMint().toBase58() === mint.toBase58()
        ? this.market.quoteDecimals()
        : this.market.baseDecimals();
    const amountAtoms = Math.ceil(amountTokens * 10 ** mintDecimals);

    return createDepositInstruction(
      {
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
      (mint.equals(this.baseMint.address) && this.isBase22) ||
      (mint.equals(this.quoteMint.address) && this.isQuote22);
    const mintDecimals =
      this.market.quoteMint().toBase58() === mint.toBase58()
        ? this.market.quoteDecimals()
        : this.market.baseDecimals();
    const amountAtoms = Math.floor(amountTokens * 10 ** mintDecimals);

    return createWithdrawInstruction(
      {
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
   * @param params WrapperPlaceOrderParamsExternal including all the information for
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
    let depositMint: PublicKey;
    let depositAmount = 0;

    if (params.isBid) {
      depositMint = this.market.quoteMint();
      depositAmount = params.numBaseTokens * params.tokenPrice - currentBalance;
    } else {
      depositMint = this.market.baseMint();
      depositAmount = params.numBaseTokens - currentBalance;
    }

    if (depositAmount <= 0) {
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
   * killSwitchMarket transactions. Pulls all orders
   * and withdraws all balances from the market in two transactions
   *
   * @param payer PublicKey of the trader
   *
   * @returns TransactionSignatures[]
   */
  public async killSwitchMarket(
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
        skipPreflight: true,
        commitment: 'confirmed',
      },
    );
    // TOOD: Merge this into one transaction
    await this.market.reload(this.connection);
    const withdrawAllIx = this.withdrawAllIx();
    const withdrawAllTx = new Transaction();
    const wihdrawAllSig = await sendAndConfirmTransaction(
      this.connection,
      withdrawAllTx.add(...withdrawAllIx),
      [payerKeypair],
      {
        skipPreflight: true,
        commitment: 'confirmed',
      },
    );
    return [cancelAllSig, wihdrawAllSig];
  }

  /**
   * CreateGlobalCreate instruction. Creates the global account. Should be used only once per mint.
   *
   * @param connection Connection to pull mint info
   * @param payer PublicKey of the trader
   * @param globalMint PublicKey of the globalMint
   *
   * @returns Promise<TransactionInstruction>
   */
  private static async createGlobalCreateIx(
    connection: Connection,
    payer: PublicKey,
    globalMint: PublicKey,
  ): Promise<TransactionInstruction> {
    const global: PublicKey = getGlobalAddress(globalMint);
    const globalVault: PublicKey = getGlobalVaultAddress(globalMint);
    const mintInfo: Mint = await getMint(connection, globalMint);
    const is22: boolean = mintInfo.tlvData.length > 0;
    return createGlobalCreateInstruction({
      payer,
      global,
      mint: globalMint,
      globalVault,
      tokenProgram: is22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    });
  }

  /**
   * CreateGlobalAddTrader instruction. Adds a new trader to the global account
   *
   * @param payer PublicKey of the trader
   * @param globalMint PublicKey of the globalMint
   *
   * @returns TransactionInstruction
   */
  public static createGlobalAddTraderIx(
    payer: PublicKey,
    globalMint: PublicKey,
  ): TransactionInstruction {
    const global: PublicKey = getGlobalAddress(globalMint);
    return createGlobalAddTraderInstruction({
      payer,
      global,
    });
  }

  /**
   * Global deposit instruction
   *
   * @param connection Connection to pull mint info
   * @param payer PublicKey of the trader
   * @param globalMint PublicKey for global mint deposit.
   * @param amountTokens Number of tokens to deposit.
   *
   * @returns Promise<TransactionInstruction>
   */
  public static async globalDepositIx(
    connection,
    payer: PublicKey,
    globalMint: PublicKey,
    amountTokens: number,
  ): Promise<TransactionInstruction> {
    const globalAddress: PublicKey = getGlobalAddress(globalMint);
    const globalVault: PublicKey = getGlobalVaultAddress(globalMint);
    const traderTokenAccount: PublicKey = getAssociatedTokenAddressSync(
      globalMint,
      payer,
    );
    const mintInfo: Mint = await getMint(connection, globalMint);
    const is22: boolean = mintInfo.tlvData.length > 0;
    const mintDecimals = mintInfo.decimals;
    const amountAtoms = Math.ceil(amountTokens * 10 ** mintDecimals);

    return createGlobalDepositInstruction(
      {
        payer: payer,
        global: globalAddress,
        mint: globalMint,
        globalVault: globalVault,
        traderToken: traderTokenAccount,
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
   * Global withdraw instruction
   *
   * @param connection Connection to pull mint info
   * @param payer PublicKey of the trader
   * @param globalMint PublicKey for global mint withdraw.
   * @param amountTokens Number of tokens to withdraw.
   *
   * @returns Promise<TransactionInstruction>
   */
  public static async globalWithdrawIx(
    connection,
    payer: PublicKey,
    globalMint: PublicKey,
    amountTokens: number,
  ): Promise<TransactionInstruction> {
    const globalAddress: PublicKey = getGlobalAddress(globalMint);
    const globalVault: PublicKey = getGlobalVaultAddress(globalMint);
    const traderTokenAccount: PublicKey = getAssociatedTokenAddressSync(
      globalMint,
      payer,
    );
    const mintInfo: Mint = await getMint(connection, globalMint);
    const is22: boolean = mintInfo.tlvData.length > 0;
    const mintDecimals = mintInfo.decimals;
    const amountAtoms = Math.ceil(amountTokens * 10 ** mintDecimals);

    return createGlobalWithdrawInstruction(
      {
        payer: payer,
        global: globalAddress,
        mint: globalMint,
        globalVault: globalVault,
        traderToken: traderTokenAccount,
        tokenProgram: is22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      },
      {
        params: {
          amountAtoms,
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
