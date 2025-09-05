import WebSocket from 'ws';
import { sleep } from '@/lib/util';
import { Mutex } from 'async-mutex';
import { Metaplex, Pda } from '@metaplex-foundation/js';
import {
  ENV,
  TokenInfo,
  TokenListContainer,
  TokenListProvider,
} from '@solana/spl-token-registry';
import * as promClient from 'prom-client';
import cors from 'cors';
import express, { RequestHandler } from 'express';
import promBundle from 'express-prom-bundle';
import {
  AccountInfo,
  Connection,
  GetProgramAccountsResponse,
  PublicKey,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getMetadataPointerState,
  getTokenMetadata,
  unpackMint,
} from '@solana/spl-token';
import {
  FillLogResult,
  ManifestClient,
  Market,
  RestingOrder,
} from '@cks-systems/manifest-sdk';
import { Pool } from 'pg';

// Stores checkpoints every 5 minutes
const CHECKPOINT_DURATION_SEC: number = 5 * 60;
const ONE_DAY_SEC: number = 24 * 60 * 60;
const PORT: number = 3000;
const DEPTHS_BPS: number[] = [50, 100, 200];

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

const fills: promClient.Counter<'market'> = new promClient.Counter({
  name: 'fills',
  help: 'Number of fills',
  labelNames: ['market'] as const,
});

const reconnects: promClient.Counter<string> = new promClient.Counter({
  name: 'reconnects',
  help: 'Number of reconnects to websocket',
});

const volume: promClient.Gauge<'market' | 'mint' | 'side'> =
  new promClient.Gauge({
    name: 'volume',
    help: 'Volume in last 24 hours in tokens',
    labelNames: ['market', 'mint', 'side'] as const,
  });

const lastPrice: promClient.Gauge<'market'> = new promClient.Gauge({
  name: 'last_price',
  help: 'Last traded price',
  labelNames: ['market'] as const,
});

const depth: promClient.Gauge<'depth_bps' | 'market' | 'trader'> =
  new promClient.Gauge({
    name: 'depth',
    help: 'Notional in orders at a given depth by trader',
    labelNames: ['depth_bps', 'market', 'trader'] as const,
  });

/**
 * Server for serving stats according to this spec:
 * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0
 */
export class ManifestStatsServer {
  private connection: Connection;
  private ws: WebSocket | null = null;
  // Base and quote volume
  private baseVolumeAtomsSinceLastCheckpoint: Map<string, number> = new Map();
  private quoteVolumeAtomsSinceLastCheckpoint: Map<string, number> = new Map();

  // Hourly checkpoints
  private baseVolumeAtomsCheckpoints: Map<string, number[]> = new Map();
  private quoteVolumeAtomsCheckpoints: Map<string, number[]> = new Map();

  // Last price by market. Price is in atoms per atom.
  private lastPriceByMarket: Map<string, number> = new Map();

  // Pubkey to the number of taker & maker trades.
  private traderNumTakerTrades: Map<string, number> = new Map();
  private traderNumMakerTrades: Map<string, number> = new Map();

  private traderPositions: Map<string, Map<string, number>> = new Map();
  private traderAcquisitionValue: Map<string, Map<string, number>> = new Map();

  // Market objects used for mints and decimals.
  private markets: Map<string, Market> = new Map();

  // Tickers. Ticker from metaplex metadata with a fallback to spl token
  // registry for old stuff like wsol.
  private tickers: Map<string, [string, string]> = new Map();

  private lastFillSlot: number = 0;

  // Recent fill log results
  private fillLogResults: Map<string, FillLogResult[]> = new Map();

  // Mutex to guard all the recent fills, volume, ... Most important for recent
  // fills when a fill spills over to multiple maker orders and bursts in fill
  // logs.
  private fillMutex: Mutex = new Mutex();

  private traderTakerNotionalVolume: Map<string, number> = new Map();
  private traderMakerNotionalVolume: Map<string, number> = new Map();
  private readonly SOL_USDC_MARKET =
    'ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ';
  private readonly USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  private readonly KNOWN_AGGREGATORS = new Set([
    'D5YqVMoSxnqeZAKAUUE1Dm3bmjtdxQ5DCF356ozqN9cM', // Titan
  ]);
  private pool: Pool;

  constructor() {
    this.connection = new Connection(RPC_URL!);
    this.resetWebsocket();
    this.connection = new Connection(RPC_URL!);

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // May be needed depending on Fly Postgres configuration
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
      // Continue operation - don't let DB errors crash the server
    });

    this.resetWebsocket();
    this.initDatabase(); // Initialize database schema
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delay = 1000,
  ): Promise<T> {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        console.error(
          `Database operation failed (attempt ${attempt + 1}/${maxRetries}):`,
          error,
        );
        lastError = error;
        if (attempt < maxRetries - 1) {
          await sleep(delay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }
    throw lastError;
  }

  private initTraderPositionTracking(trader: string): void {
    if (!this.traderPositions.has(trader)) {
      this.traderPositions.set(trader, new Map<string, number>());
    }
    if (!this.traderAcquisitionValue.has(trader)) {
      this.traderAcquisitionValue.set(trader, new Map<string, number>());
    }
  }

  private updateTraderPosition(
    trader: string,
    baseMint: string,
    baseAtomsDelta: number,
    quoteAtoms: number,
    market: Market,
  ): void {
    const positions = this.traderPositions.get(trader)!;
    const acquisitionValues = this.traderAcquisitionValue.get(trader)!;

    // Get current position
    const currentPosition = positions.get(baseMint) || 0;
    const newPosition = currentPosition + baseAtomsDelta;

    // Update position
    positions.set(baseMint, newPosition);

    // Get current acquisition value
    const currentValue = acquisitionValues.get(baseMint) || 0;
    const usdcValue = Number(quoteAtoms) / 10 ** market.quoteDecimals();

    if (baseAtomsDelta > 0) {
      acquisitionValues.set(baseMint, currentValue + usdcValue);
    } else {
      acquisitionValues.set(baseMint, currentValue - usdcValue);
    }
  }

  /**
   * Save complete fill to database immediately (async, non-blocking)
   */
  private async saveCompleteFillToDatabase(fill: FillLogResult): Promise<void> {
    try {
      await this.withRetry(async () => {
        await this.pool.query(
          `
        INSERT INTO fills_complete (
          slot, market, signature, taker, maker, 
          taker_sequence_number, maker_sequence_number, fill_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (signature, taker_sequence_number, maker_sequence_number) 
        DO NOTHING
      `,
          [
            fill.slot,
            fill.market,
            fill.signature,
            fill.taker,
            fill.maker,
            fill.takerSequenceNumber,
            fill.makerSequenceNumber,
            JSON.stringify(fill),
          ],
        );
      });
    } catch (error) {
      console.error('Error saving complete fill to database:', error);
      // Don't throw - fire and forget
    }
  }

  private async processFillAsync(fill: FillLogResult): Promise<void> {
    try {
      const {
        market,
        baseAtoms,
        quoteAtoms,
        priceAtoms,
        taker,
        maker,
        originalSigner,
      } = fill;

      const actualTaker = this.resolveActualTrader(taker, originalSigner);

      // Update trader counts
      this.traderNumTakerTrades.set(
        actualTaker,
        (this.traderNumTakerTrades.get(actualTaker) || 0) + 1,
      );
      this.traderNumMakerTrades.set(
        maker,
        (this.traderNumMakerTrades.get(maker) || 0) + 1,
      );

      // Initialize notional volumes if needed
      if (!this.traderTakerNotionalVolume.has(actualTaker)) {
        this.traderTakerNotionalVolume.set(actualTaker, 0);
      }
      if (!this.traderMakerNotionalVolume.has(maker)) {
        this.traderMakerNotionalVolume.set(maker, 0);
      }

      // Load market if needed (this is the slow part)
      let marketObject = this.markets.get(market);
      if (!marketObject) {
        marketObject = await this.loadNewMarket(market);
        if (!marketObject) {
          console.error('Failed to load market:', market);
          return;
        }
      }

      // Update price and volume
      lastPrice.set(
        { market },
        priceAtoms *
          10 ** (marketObject.baseDecimals() - marketObject.quoteDecimals()),
      );

      this.lastPriceByMarket.set(market, priceAtoms);
      this.baseVolumeAtomsSinceLastCheckpoint.set(
        market,
        (this.baseVolumeAtomsSinceLastCheckpoint.get(market) || 0) +
          Number(baseAtoms),
      );
      this.quoteVolumeAtomsSinceLastCheckpoint.set(
        market,
        (this.quoteVolumeAtomsSinceLastCheckpoint.get(market) || 0) +
          Number(quoteAtoms),
      );

      // Process notional volumes and positions
      await this.updateTradingMetrics(fill, marketObject, actualTaker);
    } catch (error) {
      console.error(
        'Error in background fill processing:',
        error,
        'Fill:',
        fill,
      );
      // Don't throw - this is fire-and-forget
    }
  }

  // Helper method for market loading
  private async loadNewMarket(market: string): Promise<Market | undefined> {
    try {
      this.baseVolumeAtomsSinceLastCheckpoint.set(market, 0);
      this.quoteVolumeAtomsSinceLastCheckpoint.set(market, 0);
      this.baseVolumeAtomsCheckpoints.set(
        market,
        new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
      );
      this.quoteVolumeAtomsCheckpoints.set(
        market,
        new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
      );

      const marketPk = new PublicKey(market);
      const marketObject = await Market.loadFromAddress({
        connection: this.connection,
        address: marketPk,
      });

      this.markets.set(market, marketObject);
      const metaplex: Metaplex = Metaplex.make(this.connection);
      const baseSymbol = await this.lookupMintTicker(
        metaplex,
        marketObject.baseMint(),
      );
      const quoteSymbol = await this.lookupMintTicker(
        metaplex,
        marketObject.quoteMint(),
      );

      this.tickers.set(market, [baseSymbol, quoteSymbol]);

      return marketObject;
    } catch (error) {
      console.error('Error loading market:', market, error);
      return undefined; // Changed from null to undefined
    }
  }

  // Helper method for trading metrics
  private async updateTradingMetrics(
    fill: FillLogResult,
    marketObject: Market,
    actualTaker: string,
  ): Promise<void> {
    const { baseAtoms, quoteAtoms, takerIsBuy, maker } = fill;
    const quoteMint = marketObject.quoteMint().toBase58();

    if (quoteMint === this.USDC_MINT) {
      const notionalVolume =
        Number(quoteAtoms) / 10 ** marketObject.quoteDecimals();

      this.traderTakerNotionalVolume.set(
        actualTaker,
        this.traderTakerNotionalVolume.get(actualTaker)! + notionalVolume,
      );
      this.traderMakerNotionalVolume.set(
        maker,
        this.traderMakerNotionalVolume.get(maker)! + notionalVolume,
      );

      const baseMint = marketObject.baseMint().toBase58();
      this.initTraderPositionTracking(actualTaker);
      this.initTraderPositionTracking(maker);

      this.updateTraderPosition(
        actualTaker,
        baseMint,
        takerIsBuy ? Number(baseAtoms) : -Number(baseAtoms),
        Number(quoteAtoms),
        marketObject,
      );

      this.updateTraderPosition(
        maker,
        baseMint,
        takerIsBuy ? -Number(baseAtoms) : Number(baseAtoms),
        Number(quoteAtoms),
        marketObject,
      );
    } else if (quoteMint === this.SOL_MINT) {
      const solPriceAtoms = this.lastPriceByMarket.get(this.SOL_USDC_MARKET);
      if (solPriceAtoms) {
        const solUsdcMarket = this.markets.get(this.SOL_USDC_MARKET);
        if (solUsdcMarket) {
          const solPrice =
            solPriceAtoms *
            10 **
              (solUsdcMarket.baseDecimals() - solUsdcMarket.quoteDecimals());
          const notionalVolume =
            (Number(quoteAtoms) / 10 ** marketObject.quoteDecimals()) *
            solPrice;

          this.traderTakerNotionalVolume.set(
            actualTaker,
            this.traderTakerNotionalVolume.get(actualTaker)! + notionalVolume,
          );
          this.traderMakerNotionalVolume.set(
            maker,
            this.traderMakerNotionalVolume.get(maker)! + notionalVolume,
          );
        }
      }
    }
  }

  private isKnownAggregator(address: string): boolean {
    return this.KNOWN_AGGREGATORS.has(address);
  }

  private resolveActualTrader(trader: string, originalSigner?: string): string {
    if (originalSigner && this.isKnownAggregator(trader)) {
      return originalSigner;
    }
    return trader;
  }

  // TODO: PnL on all quote asset markets
  private calculateTraderPnL(
    trader: string,
    includeDetails: boolean = false,
  ):
    | number
    | {
        totalPnL: number;
        positions: {
          [mint: string]: {
            tokenMint: string;
            marketKey: string | null;
            position: number;
            acquisitionValue: number;
            currentPrice: number;
            marketValue: number;
            pnl: number;
          };
        };
      } {
    let totalPnL = 0;

    if (!this.traderPositions.has(trader)) {
      return includeDetails ? { totalPnL: 0, positions: {} } : 0;
    }

    // Setup for detailed return if needed
    const positionDetails: {
      [mint: string]: {
        tokenMint: string;
        marketKey: string | null;
        position: number;
        acquisitionValue: number;
        currentPrice: number;
        marketValue: number;
        pnl: number;
      };
    } = {};

    const positions = this.traderPositions.get(trader)!;
    const acquisitionValues = this.traderAcquisitionValue.get(trader)!;

    // Calculate PnL for each base token position
    for (const [baseMint, baseAtomPosition] of positions.entries()) {
      // Skip zero positions
      if (baseAtomPosition === 0) continue;

      // Find USDC market for this base token
      let usdcMarket: Market | null = null;
      let marketKey: string | null = null;
      let lastPriceAtoms = 0;

      // Special handling for wSOL - directly use the preferred market
      if (baseMint === this.SOL_MINT) {
        if (this.markets.has(this.SOL_USDC_MARKET)) {
          usdcMarket = this.markets.get(this.SOL_USDC_MARKET)!;
          marketKey = this.SOL_USDC_MARKET;
          lastPriceAtoms = this.lastPriceByMarket.get(marketKey) || 0;
        }
      }

      if (!usdcMarket || !marketKey || lastPriceAtoms === 0) {
        for (const [marketPk, market] of this.markets.entries()) {
          if (
            market.baseMint().toBase58() === baseMint &&
            market.quoteMint().toBase58() === this.USDC_MINT
          ) {
            // Skip markets with zero price
            const price = this.lastPriceByMarket.get(marketPk) || 0;
            if (price > 0) {
              usdcMarket = market;
              marketKey = marketPk;
              lastPriceAtoms = price;
              break;
            }
          }
        }
      }

      // Skip if no USDC market found for this token or if price is zero
      if (!usdcMarket || !marketKey || lastPriceAtoms === 0) continue;

      // Calculate current value in USDC
      const baseDecimals = usdcMarket.baseDecimals();
      const quoteDecimals = usdcMarket.quoteDecimals();
      const basePosition = baseAtomPosition / 10 ** baseDecimals;

      // Convert price from atoms to actual price
      const priceInQuote =
        lastPriceAtoms * 10 ** (baseDecimals - quoteDecimals);

      // Calculate current market value
      const currentPositionValue = basePosition * priceInQuote;

      // Get acquisition value
      const acquisitionValue = acquisitionValues.get(baseMint) || 0;

      // PnL = current value - cost basis
      const positionPnL = currentPositionValue - acquisitionValue;

      // Add to total PnL
      totalPnL += positionPnL;

      // Store detailed position info if requested
      if (includeDetails) {
        positionDetails[baseMint] = {
          tokenMint: baseMint,
          marketKey,
          position: basePosition,
          acquisitionValue,
          currentPrice: priceInQuote,
          marketValue: currentPositionValue,
          pnl: positionPnL,
        };
      }
    }

    // Return either detailed object or just the total PnL number
    return includeDetails ? { totalPnL, positions: positionDetails } : totalPnL;
  }

  private resetWebsocket() {
    // Allow old one to timeout.
    if (this.ws != null) {
      try {
        this.ws.close();
      } catch (err) {
        /* empty */
      }
    }

    this.ws = new WebSocket('wss://mfx-feed-mainnet.fly.dev');

    this.ws.onopen = () => {};

    this.ws.onclose = () => {
      // Rely on the next iteration to force a reconnect. This happens without a
      // keep-alive.
      reconnects.inc();
    };
    this.ws.onerror = () => {
      // Rely on the next iteration to force a reconnect.
      reconnects.inc();
    };

    this.ws.onmessage = (message) => {
      this.fillMutex.runExclusive(async () => {
        let fill: FillLogResult;

        try {
          fill = JSON.parse(message.data.toString());
        } catch (error) {
          console.error('Failed to parse fill message:', error);
          return;
        }

        // Track slot for database persistence
        this.lastFillSlot = Math.max(this.lastFillSlot, fill.slot);

        // Immediately save to recent fill
        const { market } = fill;
        if (!this.fillLogResults.has(market)) {
          this.fillLogResults.set(market, []);
        }

        const prevFills = this.fillLogResults.get(market)!;
        prevFills.push(fill);

        const FILLS_TO_SAVE = 1000;
        if (prevFills.length > FILLS_TO_SAVE) {
          prevFills.splice(0, prevFills.length - FILLS_TO_SAVE);
        }
        this.fillLogResults.set(market, prevFills);

        fills.inc({ market });
        console.log('Got fill', fill);

        // Queue for background processing
        setImmediate(() => this.processFillAsync(fill));
        setImmediate(() => this.saveCompleteFillToDatabase(fill));
      });
    };
  }

  /**
   * Initialize at the start with a get program accounts.
   */
  async initialize(): Promise<void> {
    await this.loadState();
    let marketProgramAccounts: GetProgramAccountsResponse;
    try {
      marketProgramAccounts = await this.withRetry(
        () => ManifestClient.getMarketProgramAccounts(this.connection),
        5, // 5 retries
        2000, // 2s delay, exponential backoff
      );
      console.log(
        `Successfully loaded ${marketProgramAccounts.length} markets`,
      );
    } catch (error) {
      console.error(
        'Failed to load market program accounts after retries:',
        error,
      );
      console.log('Attempting to recover markets from database...');

      // Try to recover market addresses from database
      try {
        // Find the most recent checkpoint that actually has market data
        const checkpointResult = await this.pool.query(`
          SELECT sc.id, sc.created_at, COUNT(mc.market) as market_count
          FROM state_checkpoints sc
          LEFT JOIN market_checkpoints mc ON sc.id = mc.checkpoint_id
          GROUP BY sc.id, sc.created_at
          HAVING COUNT(mc.market) > 0
          ORDER BY sc.created_at DESC
          LIMIT 1
        `);

        if (checkpointResult.rowCount === 0) {
          console.log('No checkpoints with market data found in database');
          marketProgramAccounts = [];
          return;
        }

        const checkpointId = checkpointResult.rows[0].id;
        const marketCount = checkpointResult.rows[0].market_count;
        const checkpointDate = checkpointResult.rows[0].created_at;
        console.log(
          `Using checkpoint ${checkpointId} (${checkpointDate}) with ${marketCount} markets for recovery`,
        );

        const dbMarkets = await this.pool.query(
          'SELECT DISTINCT market FROM market_checkpoints WHERE checkpoint_id = $1 ORDER BY market',
          [checkpointId],
        );
        console.log(
          `Confirmed ${dbMarkets.rows.length} markets in checkpoint ${checkpointId}`,
        );

        if (dbMarkets.rows.length > 0) {
          // Load markets from database addresses
          const marketAddresses = dbMarkets.rows.map((row) => row.market);
          const recoveredMarkets = [];

          for (const marketAddress of marketAddresses) {
            try {
              const marketPk = new PublicKey(marketAddress);
              const accountInfo =
                await this.connection.getAccountInfo(marketPk);
              if (accountInfo) {
                recoveredMarkets.push({
                  account: accountInfo,
                  pubkey: marketPk,
                });
              }
            } catch (err) {
              console.warn(`Failed to load market ${marketAddress}:`, err);
            }
          }
          marketProgramAccounts = recoveredMarkets;
          console.log(
            `Recovered ${marketProgramAccounts.length} markets from database`,
          );
        } else {
          console.log(
            'No markets found in database, starting with empty state',
          );
          marketProgramAccounts = [];
        }
      } catch (dbError) {
        console.error('Database recovery failed:', dbError);
        marketProgramAccounts = [];
      }
    }
    marketProgramAccounts.forEach(
      (
        value: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>,
      ) => {
        const marketPk: string = value.pubkey.toBase58();
        const market: Market = Market.loadFromBuffer({
          buffer: value.account.data,
          address: new PublicKey(marketPk),
        });
        // Skip markets that have never traded to keep the amount of data
        // retention smaller.
        if (Number(market.quoteVolume()) == 0) {
          return;
        }

        if (!this.baseVolumeAtomsCheckpoints.has(marketPk)) {
          this.baseVolumeAtomsSinceLastCheckpoint.set(marketPk, 0);
          this.quoteVolumeAtomsSinceLastCheckpoint.set(marketPk, 0);
          this.baseVolumeAtomsCheckpoints.set(
            marketPk,
            new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
          );
          this.quoteVolumeAtomsCheckpoints.set(
            marketPk,
            new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
          );
        }
        this.markets.set(marketPk, market);
      },
    );

    const mintToSymbols: Map<string, string> = new Map();
    const metaplex: Metaplex = Metaplex.make(this.connection);

    // Process metadata loading with error handling
    try {
      const marketEntries = Array.from(this.markets.entries());
      for (const [marketAddress, market] of marketEntries) {
        try {
          const baseMint: PublicKey = market.baseMint();
          const quoteMint: PublicKey = market.quoteMint();

          let baseSymbol = '';
          let quoteSymbol = '';
          if (mintToSymbols.has(baseMint.toBase58())) {
            baseSymbol = mintToSymbols.get(baseMint.toBase58())!;
          } else {
            // Sleep to backoff on RPC load.
            await new Promise((f) => setTimeout(f, 500));
            baseSymbol = await this.lookupMintTicker(metaplex, baseMint);
          }
          mintToSymbols.set(baseMint.toBase58(), baseSymbol);

          if (mintToSymbols.has(quoteMint.toBase58())) {
            quoteSymbol = mintToSymbols.get(quoteMint.toBase58())!;
          } else {
            quoteSymbol = await this.lookupMintTicker(metaplex, quoteMint);
          }
          mintToSymbols.set(quoteMint.toBase58(), quoteSymbol);

          this.tickers.set(marketAddress, [baseSymbol, quoteSymbol]);
        } catch (error) {
          console.warn(
            `Failed to load metadata for market ${marketAddress}:`,
            error,
          );
          // Set fallback ticker data
          const baseMint = market.baseMint().toBase58();
          const quoteMint = market.quoteMint().toBase58();
          this.tickers.set(marketAddress, [
            baseMint.substring(0, 8) + '...',
            quoteMint.substring(0, 8) + '...',
          ]);
        }
      }
    } catch (error) {
      console.error('Error in metadata loading loop:', error);
      console.log('Server will continue with limited ticker data');
    }
  }

  async lookupMintTicker(metaplex: Metaplex, mint: PublicKey) {
    // First try Metaplex metadata for SPL tokens
    try {
      const metadataAccount: Pda = metaplex.nfts().pdas().metadata({ mint });
      const metadataAccountInfo =
        await this.connection.getAccountInfo(metadataAccount);
      if (metadataAccountInfo) {
        const token = await metaplex.nfts().findByMint({ mintAddress: mint });
        return token.symbol;
      }
    } catch (error) {
      console.log(
        'Metaplex metadata lookup failed for',
        mint.toBase58(),
        error,
      );
    }

    // Then try SPL token registry
    try {
      const provider: TokenListContainer =
        await new TokenListProvider().resolve();
      const tokenList: TokenInfo[] = provider
        .filterByChainId(ENV.MainnetBeta)
        .getList();
      const tokenMap: Map<string, TokenInfo> = tokenList.reduce((map, item) => {
        map.set(item.address, item);
        return map;
      }, new Map<string, TokenInfo>());

      const token: TokenInfo | undefined = tokenMap.get(mint.toBase58());
      if (token) {
        return token.symbol;
      }
    } catch (error) {
      console.log(
        'SPL token registry lookup failed for',
        mint.toBase58(),
        error,
      );
    }

    // Finally try Token2022 metadata extension as fallback
    try {
      const mintAccountInfo = await this.connection.getAccountInfo(mint);
      if (
        mintAccountInfo &&
        mintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ) {
        const mintData = unpackMint(
          mint,
          mintAccountInfo,
          TOKEN_2022_PROGRAM_ID,
        );
        const metadataPointer = getMetadataPointerState(mintData);

        if (metadataPointer && metadataPointer.metadataAddress) {
          const metadata = await getTokenMetadata(
            this.connection,
            mint,
            'confirmed',
            TOKEN_2022_PROGRAM_ID,
          );
          if (metadata && metadata.symbol) {
            return metadata.symbol;
          }
        }
      }
    } catch (error) {
      console.log(
        'Token2022 metadata lookup failed for',
        mint.toBase58(),
        error,
      );
    }

    // Return a fallback identifier if all lookups fail
    return mint.toBase58().substring(0, 8) + '...';
  }

  /**
   * Periodically save the volume so a 24 hour rolling volume can be calculated.
   */
  saveCheckpoints(): void {
    console.log('Saving checkpoints');

    // Reset the websocket. It sometimes disconnects quietly, so just to be
    // safe, do it here.
    this.resetWebsocket();

    this.markets.forEach((value: Market, market: string) => {
      console.log(
        'Saving checkpoints for market',
        market,
        'base since last',
        this.baseVolumeAtomsSinceLastCheckpoint.get(market),
      );
      this.baseVolumeAtomsCheckpoints.set(market, [
        ...this.baseVolumeAtomsCheckpoints.get(market)!.slice(1),
        this.baseVolumeAtomsSinceLastCheckpoint.get(market)!,
      ]);
      this.baseVolumeAtomsSinceLastCheckpoint.set(market, 0);

      this.quoteVolumeAtomsCheckpoints.set(market, [
        ...this.quoteVolumeAtomsCheckpoints.get(market)!.slice(1),
        this.quoteVolumeAtomsSinceLastCheckpoint.get(market)!,
      ]);
      this.quoteVolumeAtomsSinceLastCheckpoint.set(market, 0);

      const baseMint: string = value.baseMint().toBase58();
      const quoteMint: string = value.quoteMint().toBase58();
      volume.set(
        { market, mint: baseMint, side: 'base' },
        this.baseVolumeAtomsCheckpoints
          .get(market)!
          .reduce((sum, num) => sum + num, 0),
      );
      volume.set(
        { market, mint: quoteMint, side: 'quote' },
        this.quoteVolumeAtomsCheckpoints
          .get(market)!
          .reduce((sum, num) => sum + num, 0),
      );
    });
  }

  /**
   * Periodically save to prometheus the depths of different market makers. This
   * is expensive, so it will only be run every few minutes at most. If we
   * wanted more frequent, should subscribe to market accounts. Because the
   * number of markets is unbounded, that is not done here.
   */
  async depthProbe(): Promise<void> {
    console.log('Probing depths for market maker data');

    const marketKeys: PublicKey[] = Array.from(this.markets.keys()).map(
      (market: string) => {
        return new PublicKey(market);
      },
    );

    try {
      const marketKeysChunks: PublicKey[][] = chunks(marketKeys, 100);
      for (const marketKeysChunk of marketKeysChunks) {
        const accountInfos: (AccountInfo<Buffer> | null)[] =
          await this.connection.getMultipleAccountsInfo(marketKeysChunk);
        accountInfos.forEach(
          (accountInfo: AccountInfo<Buffer> | null, index: number) => {
            if (!accountInfo) {
              return;
            }
            const marketPk: PublicKey = marketKeys[index];
            const market: Market = Market.loadFromBuffer({
              buffer: accountInfo.data,
              address: marketPk,
            });
            const bids: RestingOrder[] = market.bids();
            const asks: RestingOrder[] = market.asks();
            if (bids.length == 0 || asks.length == 0) {
              return;
            }

            const midTokens: number =
              (bids[bids.length - 1].tokenPrice +
                asks[asks.length - 1].tokenPrice) /
              2;

            DEPTHS_BPS.forEach((depthBps: number) => {
              const bidsAtDepth: RestingOrder[] = bids.filter(
                (bid: RestingOrder) => {
                  return bid.tokenPrice > midTokens * (1 - depthBps * 0.0001);
                },
              );
              const asksAtDepth: RestingOrder[] = asks.filter(
                (ask: RestingOrder) => {
                  return ask.tokenPrice < midTokens * (1 + depthBps * 0.0001);
                },
              );

              const bidTraders: Set<string> = new Set(
                bidsAtDepth.map((bid: RestingOrder) => bid.trader.toBase58()),
              );

              bidTraders.forEach((trader: string) => {
                const bidTokensAtDepth: number = bidsAtDepth
                  .filter((bid: RestingOrder) => {
                    return bid.trader.toBase58() == trader;
                  })
                  .map((bid: RestingOrder) => {
                    return Number(bid.numBaseTokens);
                  })
                  .reduce((sum, num) => sum + num, 0);
                const askTokensAtDepth: number = asksAtDepth
                  .filter((ask: RestingOrder) => {
                    return ask.trader.toBase58() == trader;
                  })
                  .map((ask: RestingOrder) => {
                    return Number(ask.numBaseTokens);
                  })
                  .reduce((sum, num) => sum + num, 0);

                if (bidTokensAtDepth > 0 && askTokensAtDepth > 0) {
                  depth.set(
                    {
                      depth_bps: depthBps,
                      market: marketPk.toBase58(),
                      trader: trader,
                    },
                    Math.min(bidTokensAtDepth, askTokensAtDepth) * midTokens,
                  );
                }
              });
            });
          },
        );
      }
    } catch (err) {
      console.log('Unable to fetch depth probe', err);
    }
  }

  /**
   * Get Tickers
   *
   * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0#heading=h.pa64vhp5pbih
   */
  getTickers() {
    const tickers: any = [];
    this.markets.forEach((market: Market, marketPk: string) => {
      tickers.push({
        ticker_id: marketPk,
        base_currency: market.baseMint().toBase58(),
        target_currency: market.quoteMint().toBase58(),
        last_price:
          this.lastPriceByMarket.get(marketPk)! *
          10 ** (market.baseDecimals() - market.quoteDecimals()),
        base_volume:
          this.baseVolumeAtomsCheckpoints
            .get(marketPk)!
            .reduce((sum, num) => sum + num, 0) /
          10 ** market.baseDecimals(),
        target_volume:
          this.quoteVolumeAtomsCheckpoints
            .get(marketPk)!
            .reduce((sum, num) => sum + num, 0) /
          10 ** market.quoteDecimals(),
        pool_id: marketPk,
        // Does not apply to orderbooks.
        liquidity_in_usd: 0,
        // Optional: not yet implemented
        // "bid": 0,
        // "ask": 0,
        // "high": 0,
        // "low": 0,
      });
    });
    return tickers;
  }

  /**
   * Would be named tickers if that wasnt reserved for coingecko.
   *
   */
  getMetadata() {
    console.log('getting metadata', this.tickers.size);
    return this.tickers;
  }

  /**
   * Get Orderbook
   *
   * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0#heading=h.vgzsfbx8rvps
   */
  async getOrderbook(tickerId: string, depth: number) {
    try {
      const market: Market = await Market.loadFromAddress({
        connection: this.connection,
        address: new PublicKey(tickerId),
      });
      if (depth == 0) {
        return {
          ticker_id: tickerId,
          bids: market
            .bids()
            .reverse()
            .map((restingOrder: RestingOrder) => {
              return [
                restingOrder.tokenPrice,
                Number(restingOrder.numBaseTokens),
              ];
            }),
          asks: market
            .asks()
            .reverse()
            .map((restingOrder: RestingOrder) => {
              return [
                restingOrder.tokenPrice,
                Number(restingOrder.numBaseTokens),
              ];
            }),
        };
      }
      const bids: RestingOrder[] = market.bids().reverse();
      const asks: RestingOrder[] = market.asks().reverse();
      const bidsUpToDepth: RestingOrder[] = [];
      const asksUpToDepth: RestingOrder[] = [];
      let bidTokens: number = 0;
      let askTokens: number = 0;
      bids.forEach((bid: RestingOrder) => {
        if (bidTokens < depth) {
          bidTokens += Number(bid.numBaseTokens);
          bidsUpToDepth.push(bid);
        }
      });
      asks.forEach((ask: RestingOrder) => {
        if (askTokens < depth) {
          askTokens += Number(ask.numBaseTokens);
          asksUpToDepth.push(ask);
        }
      });

      return {
        ticker_id: tickerId,
        bids: bidsUpToDepth.map((restingOrder: RestingOrder) => {
          return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
        }),
        asks: asksUpToDepth.reverse().map((restingOrder: RestingOrder) => {
          return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
        }),
      };
    } catch (err) {
      console.log('Error getOrderbook', tickerId, depth, err);
      return {};
    }
  }

  /**
   * Get Volume
   *
   * https://docs.llama.fi/list-your-project/other-dashboards/dimensions
   */
  async getVolume() {
    const marketProgramAccounts: GetProgramAccountsResponse =
      await ManifestClient.getMarketProgramAccounts(this.connection);

    // Get SOL price for converting SOL-quoted volumes to USDC equivalent
    const solPriceAtoms = this.lastPriceByMarket.get(this.SOL_USDC_MARKET);
    const solUsdcMarket = this.markets.get(this.SOL_USDC_MARKET);
    let solPrice = 0;
    if (solPriceAtoms && solUsdcMarket) {
      solPrice =
        solPriceAtoms *
        10 ** (solUsdcMarket.baseDecimals() - solUsdcMarket.quoteDecimals());
    }

    const lifetimeVolume: number = marketProgramAccounts
      .map(
        (
          value: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>,
        ) => {
          const marketPk: string = value.pubkey.toBase58();
          const market: Market = Market.loadFromBuffer({
            buffer: value.account.data,
            address: new PublicKey(marketPk),
          });
          const quoteMint = market.quoteMint().toBase58();

          // Track USDC quote volume directly
          if (quoteMint == this.USDC_MINT) {
            return Number(market.quoteVolume()) / 10 ** 6;
          }

          // Convert SOL quote volume to USDC equivalent
          if (quoteMint == this.SOL_MINT && solPrice > 0) {
            const solVolumeNormalized =
              Number(market.quoteVolume()) / 10 ** market.quoteDecimals();
            return solVolumeNormalized * solPrice;
          }

          return 0;
        },
      )
      .reduce((sum, num) => sum + num, 0);

    const dailyVolumesByToken: Map<string, number> = new Map();
    let dailyUsdcEquivalentVolume = 0;
    let dailyDirectUsdcVolume = 0;

    this.markets.forEach((market: Market, marketPk: string) => {
      const baseVolume: number =
        this.baseVolumeAtomsCheckpoints
          .get(marketPk)!
          .reduce((sum, num) => sum + num, 0) /
        10 ** market.baseDecimals();
      const quoteVolume: number =
        this.quoteVolumeAtomsCheckpoints
          .get(marketPk)!
          .reduce((sum, num) => sum + num, 0) /
        10 ** market.quoteDecimals();
      const baseMint: string = 'solana:' + market.baseMint().toBase58();
      const quoteMint: string = 'solana:' + market.quoteMint().toBase58();
      if (baseVolume == 0 || quoteVolume == 0) {
        return;
      }
      // Track individual token volumes (excluding USDC which we'll handle separately)
      if (!dailyVolumesByToken.has(baseMint)) {
        dailyVolumesByToken.set(baseMint, 0);
      }
      dailyVolumesByToken.set(
        baseMint,
        dailyVolumesByToken.get(baseMint)! + baseVolume,
      );

      // Handle quote volumes differently for USDC vs other tokens
      if (market.quoteMint().toBase58() != this.USDC_MINT) {
        if (!dailyVolumesByToken.has(quoteMint)) {
          dailyVolumesByToken.set(quoteMint, 0);
        }
        dailyVolumesByToken.set(
          quoteMint,
          dailyVolumesByToken.get(quoteMint)! + quoteVolume,
        );
      }

      // Calculate total USDC equivalent volume
      if (market.quoteMint().toBase58() == this.SOL_MINT && solPrice > 0) {
        dailyUsdcEquivalentVolume += quoteVolume * solPrice;
      } else if (market.quoteMint().toBase58() == this.USDC_MINT) {
        dailyDirectUsdcVolume += quoteVolume;
        dailyUsdcEquivalentVolume += quoteVolume;
      }
    });

    // Report direct USDC volume separately and combined volume under USDC key
    const usdcKey = 'solana:' + this.USDC_MINT;
    if (dailyDirectUsdcVolume > 0) {
      dailyVolumesByToken.set(
        'manifest:direct_usdc_volume',
        dailyDirectUsdcVolume,
      );
    }
    if (dailyUsdcEquivalentVolume > 0) {
      dailyVolumesByToken.set(usdcKey, dailyUsdcEquivalentVolume);
    }

    return {
      totalVolume: {
        [usdcKey]: lifetimeVolume,
      },
      dailyVolume: Object.fromEntries(dailyVolumesByToken),
    };
  }
  /**
   * Get Traders to be used in a leaderboard if a UI wants to.
   * Returns counts for taker/maker trades and volumes.
   */
  getTraders(includeDebug: boolean = false) {
    const allTraders = new Set<string>([
      ...Array.from(this.traderNumTakerTrades.keys()),
      ...Array.from(this.traderNumMakerTrades.keys()),
    ]);

    const traderData: {
      [key: string]: {
        taker: number;
        maker: number;
        takerNotionalVolume: number;
        makerNotionalVolume: number;
        pnl: number;
        _debug?: any;
      };
    } = {};

    allTraders.forEach((trader) => {
      const takerNotionalVolume =
        this.traderTakerNotionalVolume.get(trader) || 0;
      const makerNotionalVolume =
        this.traderMakerNotionalVolume.get(trader) || 0;

      const pnlResult = this.calculateTraderPnL(trader, includeDebug);

      const pnl =
        typeof pnlResult === 'number' ? pnlResult : pnlResult.totalPnL;

      traderData[trader] = {
        taker: this.traderNumTakerTrades.get(trader) || 0,
        maker: this.traderNumMakerTrades.get(trader) || 0,
        takerNotionalVolume,
        makerNotionalVolume,
        pnl,
      };

      if (includeDebug && typeof pnlResult !== 'number') {
        traderData[trader]._debug = pnlResult;
      }
    });

    return traderData;
  }

  async getAlts(): Promise<{ alt: string; market: string }[]> {
    const response = await this.pool.query(
      'SELECT alt, market FROM alt_markets',
    );
    return response.rows.map((r) => ({ alt: r.alt, market: r.market }));
  }

  /**
   * Get array of recent fills.
   */
  getRecentFills(market: string) {
    return { [market]: this.fillLogResults.get(market) };
  }

  async getCompleteFillsFromDatabase(
    options: {
      market?: string;
      taker?: string;
      maker?: string;
      signature?: string;
      limit?: number;
      offset?: number;
      fromSlot?: number;
      toSlot?: number;
    } = {},
  ): Promise<{
    fills: FillLogResult[];
    total: number;
    hasMore: boolean;
  }> {
    const {
      market,
      taker,
      maker,
      signature,
      limit = 100,
      offset = 0,
      fromSlot,
      toSlot,
    } = options;

    try {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (market) {
        conditions.push(`market = $${paramIndex++}`);
        params.push(market);
      }

      if (taker) {
        conditions.push(`taker = $${paramIndex++}`);
        params.push(taker);
      }

      if (maker) {
        conditions.push(`maker = $${paramIndex++}`);
        params.push(maker);
      }

      if (signature) {
        conditions.push(`signature = $${paramIndex++}`);
        params.push(signature);
      }

      if (fromSlot) {
        conditions.push(`slot >= $${paramIndex++}`);
        params.push(fromSlot);
      }

      if (toSlot) {
        conditions.push(`slot <= $${paramIndex++}`);
        params.push(toSlot);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get count
      const countResult = await this.pool.query(
        `SELECT COUNT(*) as total FROM fills_complete ${whereClause}`,
        params,
      );
      const total = parseInt(countResult.rows[0].total);

      // Get data
      const dataQuery = `
      SELECT fill_data FROM fills_complete 
      ${whereClause}
      ORDER BY slot DESC, timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

      params.push(limit, offset);
      const dataResult = await this.pool.query(dataQuery, params);

      const fills: FillLogResult[] = dataResult.rows.map(
        (row) => row.fill_data,
      );

      return {
        fills,
        total,
        hasMore: offset + limit < total,
      };
    } catch (error) {
      console.error('Error querying complete fills:', error);
      throw error;
    }
  }

  /**
   * Set up database schema if needed
   */
  async initDatabase(): Promise<void> {
    try {
      // Create tables if they don't exist
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS state_checkpoints (
          id SERIAL PRIMARY KEY,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_fill_slot BIGINT NOT NULL
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS market_volumes (
          checkpoint_id INTEGER REFERENCES state_checkpoints(id) ON DELETE CASCADE,
          market TEXT NOT NULL,
          base_volume_since_last_checkpoint NUMERIC,
          quote_volume_since_last_checkpoint NUMERIC,
          PRIMARY KEY (checkpoint_id, market)
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS market_checkpoints (
          checkpoint_id INTEGER REFERENCES state_checkpoints(id) ON DELETE CASCADE,
          market TEXT NOT NULL,
          base_volume_checkpoints JSONB NOT NULL,
          quote_volume_checkpoints JSONB NOT NULL,
          last_price NUMERIC,
          PRIMARY KEY (checkpoint_id, market)
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS trader_stats (
          checkpoint_id INTEGER REFERENCES state_checkpoints(id) ON DELETE CASCADE,
          trader TEXT NOT NULL,
          num_taker_trades INTEGER DEFAULT 0,
          num_maker_trades INTEGER DEFAULT 0,
          taker_notional_volume NUMERIC DEFAULT 0,
          maker_notional_volume NUMERIC DEFAULT 0,
          PRIMARY KEY (checkpoint_id, trader)
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS fill_log_results (
          checkpoint_id INTEGER REFERENCES state_checkpoints(id) ON DELETE CASCADE,
          market TEXT NOT NULL,
          fill_data JSONB NOT NULL,
          PRIMARY KEY (checkpoint_id, market)
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS trader_positions (
          checkpoint_id INTEGER REFERENCES state_checkpoints(id) ON DELETE CASCADE,
          trader TEXT NOT NULL,
          mint TEXT NOT NULL,
          position NUMERIC NOT NULL,
          acquisition_value NUMERIC NOT NULL,
          PRIMARY KEY (checkpoint_id, trader, mint)
        )
      `);

      await this.pool.query(`
          CREATE TABLE IF NOT EXISTS fills_complete (
            id BIGSERIAL PRIMARY KEY,
            slot BIGINT NOT NULL,
            market TEXT NOT NULL,
            signature TEXT NOT NULL,
            taker TEXT NOT NULL,
            maker TEXT NOT NULL,
            taker_sequence_number BIGINT NOT NULL,
            maker_sequence_number BIGINT NOT NULL,
            fill_data JSONB NOT NULL,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            
            -- Optimal deduplication using signature + sequence numbers
            CONSTRAINT unique_complete_fill UNIQUE (signature, taker_sequence_number, maker_sequence_number)
          )
        `);

      // Create index for efficient querying
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_fills_complete_market_timestamp ON fills_complete (market, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_fills_complete_slot ON fills_complete (slot);
        CREATE INDEX IF NOT EXISTS idx_fills_complete_signature ON fills_complete (signature);
        CREATE INDEX IF NOT EXISTS idx_fills_complete_taker ON fills_complete (taker);
        CREATE INDEX IF NOT EXISTS idx_fills_complete_maker ON fills_complete (maker);
      `);

      await this.pool.query(`
      CREATE TABLE IF NOT EXISTS alt_markets (
        alt TEXT NOT NULL,
        market TEXT NOT NULL,
        PRIMARY KEY (alt, market)
      )
    `);

      console.log('Database schema initialized');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }

  /**
   * Save current state to database
   */
  async saveState(): Promise<void> {
    console.log('Saving state to database...');

    let client;
    try {
      console.log('Getting db client');
      client = await this.pool.connect();

      // Start a transaction
      console.log('Querying begin');
      await client.query('BEGIN');

      // Insert a new checkpoint
      console.log('Inserting checkpoint');
      const checkpointResult = await client.query(
        'INSERT INTO state_checkpoints (last_fill_slot) VALUES ($1) RETURNING id',
        [this.lastFillSlot],
      );

      const checkpointId = checkpointResult.rows[0].id;

      // Save market volumes
      const volumePromises = [];
      for (const [
        market,
        baseVolume,
      ] of this.baseVolumeAtomsSinceLastCheckpoint.entries()) {
        const quoteVolume =
          this.quoteVolumeAtomsSinceLastCheckpoint.get(market) || 0;

        volumePromises.push(
          client.query(
            'INSERT INTO market_volumes (checkpoint_id, market, base_volume_since_last_checkpoint, quote_volume_since_last_checkpoint) VALUES ($1, $2, $3, $4)',
            [checkpointId, market, baseVolume, quoteVolume],
          ),
        );
      }

      // Save market checkpoints
      const checkpointPromises = [];
      for (const [
        market,
        baseCheckpoints,
      ] of this.baseVolumeAtomsCheckpoints.entries()) {
        const quoteCheckpoints =
          this.quoteVolumeAtomsCheckpoints.get(market) || [];
        const lastPrice = this.lastPriceByMarket.get(market) || 0;

        checkpointPromises.push(
          client.query(
            'INSERT INTO market_checkpoints (checkpoint_id, market, base_volume_checkpoints, quote_volume_checkpoints, last_price) VALUES ($1, $2, $3, $4, $5)',
            [
              checkpointId,
              market,
              JSON.stringify(baseCheckpoints),
              JSON.stringify(quoteCheckpoints),
              lastPrice,
            ],
          ),
        );
      }

      console.log('Awaiting all inserts to complete');
      // Wait for all queries to complete
      await Promise.all([...volumePromises, ...checkpointPromises]);

      // Save trader stats in batches
      console.log('Saving trader stats in batches');
      const traderArray = Array.from(
        new Set([
          ...Array.from(this.traderNumTakerTrades.keys()),
          ...Array.from(this.traderNumMakerTrades.keys()),
        ]),
      );
      const TRADER_BATCH_SIZE = 20; // Process 20 traders at a time

      for (let i = 0; i < traderArray.length; i += TRADER_BATCH_SIZE) {
        const batch = traderArray.slice(i, i + TRADER_BATCH_SIZE);
        const batchPromises = [];

        for (const trader of batch) {
          const numTakerTrades = this.traderNumTakerTrades.get(trader) || 0;
          const numMakerTrades = this.traderNumMakerTrades.get(trader) || 0;
          const takerVolume = this.traderTakerNotionalVolume.get(trader) || 0;
          const makerVolume = this.traderMakerNotionalVolume.get(trader) || 0;

          batchPromises.push(
            client.query(
              'INSERT INTO trader_stats (checkpoint_id, trader, num_taker_trades, num_maker_trades, taker_notional_volume, maker_notional_volume) VALUES ($1, $2, $3, $4, $5, $6)',
              [
                checkpointId,
                trader,
                numTakerTrades,
                numMakerTrades,
                takerVolume,
                makerVolume,
              ],
            ),
          );
        }

        await Promise.all(batchPromises);
      }

      // Save trader positions with filtering and batching
      console.log('Saving trader positions with filtering');
      const POSITION_THRESHOLD = 1; // Only save positions with significant value ($1+)
      const BATCH_SIZE = 10; // Smaller batch size
      const DELAY_BETWEEN_BATCHES = 50; // ms

      // Helper function for delay
      const delay = (ms: number | undefined) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      // Process traders in smaller batches with delays
      let traderCount = 0;
      for (const [trader, positions] of this.traderPositions.entries()) {
        const acquisitionValues =
          this.traderAcquisitionValue.get(trader) || new Map();
        const positionBatchPromises = [];

        for (const [mint, position] of positions.entries()) {
          const acquisitionValue = acquisitionValues.get(mint) || 0;

          // Skip insignificant positions to reduce database load
          if (
            Math.abs(position) === 0 ||
            Math.abs(acquisitionValue) < POSITION_THRESHOLD
          ) {
            continue;
          }

          positionBatchPromises.push(
            client.query(
              'INSERT INTO trader_positions (checkpoint_id, trader, mint, position, acquisition_value) VALUES ($1, $2, $3, $4, $5)',
              [checkpointId, trader, mint, position, acquisitionValue],
            ),
          );
        }

        // Execute all position queries for this trader in parallel
        if (positionBatchPromises.length > 0) {
          await Promise.all(positionBatchPromises);

          // Add throttling delay every BATCH_SIZE traders
          traderCount++;
          if (traderCount % BATCH_SIZE === 0) {
            await delay(DELAY_BETWEEN_BATCHES);
          }
        }
      }

      // Save fill logs using bulk insertion
      console.log('Saving fill log results with bulk insertion');

      const markets = Array.from(this.fillLogResults.keys());
      const BULK_INSERT_SIZE = 100; // Can be increased for better performance

      for (let i = 0; i < markets.length; i += BULK_INSERT_SIZE) {
        const batchMarkets = markets.slice(i, i + BULK_INSERT_SIZE);
        const bulkData = [];

        // Prepare bulk data
        for (const market of batchMarkets) {
          const fills = this.fillLogResults.get(market);
          if (fills && fills.length > 0) {
            bulkData.push({
              checkpoint_id: checkpointId,
              market: market,
              fill_data: JSON.stringify(fills),
            });
          }
        }

        // Skip if nothing to insert
        if (bulkData.length === 0) continue;

        // Execute bulk insertion
        if (bulkData.length > 0) {
          console.log(`Bulk inserting ${bulkData.length} fill records`);

          // Generate a parameterized query for the bulk insertion
          const columns = ['checkpoint_id', 'market', 'fill_data'];
          const columnStr = columns.join(', ');
          const placeholders = bulkData
            .map((_, index) => {
              const offset = index * columns.length;
              return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
            })
            .join(', ');

          const values = bulkData.flatMap((row) => [
            row.checkpoint_id,
            row.market,
            row.fill_data,
          ]);

          const query = `
            INSERT INTO fill_log_results (${columnStr})
            VALUES ${placeholders}
          `;

          await client.query(query, values);
        }

        // Add a small delay between batches
        if (i + BULK_INSERT_SIZE < markets.length) {
          await delay(100);
        }
      }

      console.log('Cleaning up old checkpoints');
      // Clean up old checkpoints - keep only the most recent one
      await client.query('DELETE FROM state_checkpoints WHERE id != $1', [
        checkpointId,
      ]);

      console.log('Committing');
      await client.query('COMMIT');
      console.log('State saved successfully to database');
    } catch (error) {
      console.error('Error saving state to database:', error);
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Error during rollback:', rollbackError);
          // Continue execution even if rollback fails
        }
      }
      // Don't re-throw - we want to continue operation even after errors
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing client:', releaseError);
          // Don't throw release errors, just log them
        }
      }
    }
  }

  /**
   * Load state from database
   */
  async loadState(): Promise<boolean> {
    console.log('Loading state from database...');

    try {
      // Get the most recent checkpoint that has market data
      const checkpointResultRecent = await this.pool.query(`
        SELECT sc.id, sc.last_fill_slot, sc.created_at, COUNT(mc.market) as market_count
        FROM state_checkpoints sc
        LEFT JOIN market_checkpoints mc ON sc.id = mc.checkpoint_id
        GROUP BY sc.id, sc.last_fill_slot, sc.created_at
        HAVING COUNT(mc.market) > 0
        ORDER BY sc.created_at DESC
        LIMIT 1
      `);

      if (checkpointResultRecent.rowCount === 0) {
        console.log('No saved state with market data found in database');
        return false;
      }

      const checkpointId = checkpointResultRecent.rows[0].id;
      const marketCount = checkpointResultRecent.rows[0].market_count;
      const checkpointDate = checkpointResultRecent.rows[0].created_at;
      this.lastFillSlot = checkpointResultRecent.rows[0].last_fill_slot;

      console.log(
        `Loading state from checkpoint ${checkpointId} (${checkpointDate}) with ${marketCount} markets`,
      );

      // Load market volumes
      const volumeResult = await this.pool.query(
        'SELECT market, base_volume_since_last_checkpoint, quote_volume_since_last_checkpoint FROM market_volumes WHERE checkpoint_id = $1',
        [checkpointId],
      );

      for (const row of volumeResult.rows) {
        this.baseVolumeAtomsSinceLastCheckpoint.set(
          row.market,
          Number(row.base_volume_since_last_checkpoint),
        );
        this.quoteVolumeAtomsSinceLastCheckpoint.set(
          row.market,
          Number(row.quote_volume_since_last_checkpoint),
        );
      }

      // Load market checkpoints
      const checkpointResult = await this.pool.query(
        'SELECT market, base_volume_checkpoints::text AS base_volume_checkpoints_text, quote_volume_checkpoints::text AS quote_volume_checkpoints_text, last_price FROM market_checkpoints WHERE checkpoint_id = $1',
        [checkpointId],
      );

      for (const row of checkpointResult.rows) {
        let baseCheckpoints = JSON.parse(row.base_volume_checkpoints_text);
        let quoteCheckpoints = JSON.parse(row.quote_volume_checkpoints_text);

        if (!Array.isArray(baseCheckpoints)) {
          console.log(
            `Base checkpoints for market ${row.market} is not an array, converting`,
          );
          baseCheckpoints = Object.values(baseCheckpoints);
        }

        if (!Array.isArray(quoteCheckpoints)) {
          console.log(
            `Quote checkpoints for market ${row.market} is not an array, converting`,
          );
          quoteCheckpoints = Object.values(quoteCheckpoints);
        }

        this.baseVolumeAtomsCheckpoints.set(row.market, baseCheckpoints);
        this.quoteVolumeAtomsCheckpoints.set(row.market, quoteCheckpoints);
        this.lastPriceByMarket.set(row.market, Number(row.last_price));
      }

      // Load trader stats
      const traderResult = await this.pool.query(
        'SELECT trader, num_taker_trades, num_maker_trades, taker_notional_volume, maker_notional_volume FROM trader_stats WHERE checkpoint_id = $1',
        [checkpointId],
      );

      for (const row of traderResult.rows) {
        this.traderNumTakerTrades.set(row.trader, Number(row.num_taker_trades));
        this.traderNumMakerTrades.set(row.trader, Number(row.num_maker_trades));
        this.traderTakerNotionalVolume.set(
          row.trader,
          Number(row.taker_notional_volume),
        );
        this.traderMakerNotionalVolume.set(
          row.trader,
          Number(row.maker_notional_volume),
        );
      }

      // Load trader positions
      const positionResult = await this.pool.query(
        'SELECT trader, mint, position, acquisition_value FROM trader_positions WHERE checkpoint_id = $1',
        [checkpointId],
      );

      for (const row of positionResult.rows) {
        if (!this.traderPositions.has(row.trader)) {
          this.traderPositions.set(row.trader, new Map());
        }
        if (!this.traderAcquisitionValue.has(row.trader)) {
          this.traderAcquisitionValue.set(row.trader, new Map());
        }

        this.traderPositions
          .get(row.trader)!
          .set(row.mint, Number(row.position));
        this.traderAcquisitionValue
          .get(row.trader)!
          .set(row.mint, Number(row.acquisition_value));
      }

      // Load fill logs
      const fillResult = await this.pool.query(
        'SELECT market, fill_data FROM fill_log_results WHERE checkpoint_id = $1',
        [checkpointId],
      );

      for (const row of fillResult.rows) {
        this.fillLogResults.set(row.market, row.fill_data);
      }

      console.log('State loaded successfully from database');
      return true;
    } catch (error) {
      console.error('Error loading state from database:', error);
      return false;
    }
  }
}

const run = async () => {
  // Validate environment variables
  const { RPC_URL, DATABASE_URL } = process.env;

  if (!RPC_URL) {
    throw new Error('RPC_URL missing from env');
  }

  if (!DATABASE_URL) {
    console.warn(
      'WARNING: DATABASE_URL not found in environment. Data persistence will not work!',
    );
  }

  // Set up Prometheus metrics
  promClient.collectDefaultMetrics({
    labels: {
      app: 'stats',
    },
  });

  const register = new promClient.Registry();
  register.setDefaultLabels({
    app: 'stats',
  });
  const metricsApp = express();
  metricsApp.listen(9090);

  const promMetrics = promBundle({
    includeMethod: true,
    metricsApp,
    autoregister: false,
  });
  metricsApp.use(promMetrics);

  // Initialize the stats server
  const statsServer: ManifestStatsServer = new ManifestStatsServer();

  try {
    await statsServer.initialize();
  } catch (error) {
    console.error('Error initializing server:', error);
    throw error;
  }

  // Set up Express routes
  const tickersHandler: RequestHandler = (_req, res) => {
    res.send(statsServer.getTickers());
  };
  const metadataHandler: RequestHandler = (_req, res) => {
    res.send(JSON.stringify(Object.fromEntries(statsServer.getMetadata())));
  };
  const orderbookHandler: RequestHandler = async (req, res) => {
    res.send(
      await statsServer.getOrderbook(
        req.query.ticker_id as string,
        Number(req.query.depth),
      ),
    );
  };
  const volumeHandler: RequestHandler = async (_req, res) => {
    res.send(await statsServer.getVolume());
  };
  const tradersHandler: RequestHandler = (req, res) => {
    const includeDebug = req.query.debug === 'true';
    res.send(statsServer.getTraders(includeDebug));
  };
  const recentFillsHandler: RequestHandler = (req, res) => {
    res.send(statsServer.getRecentFills(req.query.market as string));
  };
  const completeFillsHandler: RequestHandler = async (req, res) => {
    try {
      const options = {
        market: req.query.market as string,
        taker: req.query.taker as string,
        maker: req.query.maker as string,
        signature: req.query.signature as string,
        limit: parseInt(req.query.limit as string) || 100,
        offset: parseInt(req.query.offset as string) || 0,
        fromSlot: req.query.fromSlot
          ? parseInt(req.query.fromSlot as string)
          : undefined,
        toSlot: req.query.toSlot
          ? parseInt(req.query.toSlot as string)
          : undefined,
      };

      const result = await statsServer.getCompleteFillsFromDatabase(options);
      res.send(result);
    } catch (error) {
      console.error('Error in completeFills handler:', error);
      res.status(500).send({ error: 'Internal server error' });
    }
  };
  const altsHandler: RequestHandler = async (_req, res) => {
    res.send(await statsServer.getAlts());
  };

  const app = express();
  app.use(cors());
  app.get('/tickers', tickersHandler);
  app.get('/metadata', metadataHandler);
  app.get('/orderbook', orderbookHandler);
  app.get('/volume', volumeHandler);
  app.get('/traders', tradersHandler);
  app.get('/traders/debug', (req, res) => {
    res.send(statsServer.getTraders(true));
  });
  app.get('/recentFills', recentFillsHandler);
  app.get('/completeFills', completeFillsHandler);
  app.get('/alts', altsHandler);

  // Add health check endpoint for Fly.io
  app.get('/health', (_req, res) => {
    res.status(200).send('OK');
  });

  app.listen(Number(PORT!), () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Set up graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}, saving state before exit...`);
    try {
      if (DATABASE_URL) {
        await statsServer.saveState();
      }
      console.log('State saved, exiting');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Main loop with periodic state saving and checkpointing
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      statsServer.saveCheckpoints();

      // Run depth probe and wait for next checkpoint
      await Promise.all([
        statsServer.depthProbe(),
        sleep(CHECKPOINT_DURATION_SEC * 1_000),
        DATABASE_URL ? statsServer.saveState() : () => {},
      ]);
    } catch (error) {
      console.error('Error in main loop:', error);
      // Continue the loop instead of crashing
      await sleep(5000); // Add a short delay before retrying
    }
  }
};

run().catch((e) => {
  console.error('fatal error');
  throw e;
});

function chunks<T>(array: T[], size: number): T[][] {
  return Array.apply(0, new Array(Math.ceil(array.length / size))).map(
    (_, index) => array.slice(index * size, (index + 1) * size),
  );
}
