import { Mutex } from 'async-mutex';
import * as promClient from 'prom-client';
import {
  AccountInfo,
  Connection,
  GetProgramAccountsResponse,
  PublicKey,
} from '@solana/web3.js';
import {
  FillLogResult,
  ManifestClient,
  Market,
  RestingOrder,
} from '@cks-systems/manifest-sdk';
import { Pool } from 'pg';
import {
  CHECKPOINT_DURATION_SEC,
  ONE_DAY_SEC,
  DEPTHS_BPS,
  SOL_USDC_MARKET,
  CBBTC_USDC_MARKET,
  WBTC_USDC_MARKET,
  USDC_MINT,
  SOL_MINT,
  CBBTC_MINT,
  WBTC_MINT,
  STABLECOIN_MINTS,
} from './constants';
import {
  resolveActualTrader,
  chunks,
  fetchBtcPriceFromCoinGecko,
  getLifetimeVolumeForMarkets,
} from './utils';
import * as queries from './queries';
import { lookupMintTicker } from './mint';
import { fetchMarketProgramAccounts } from './marketFetcher';
import { calculateTraderPnL } from './pnl';
import { CompleteFillsQueryOptions, CompleteFillsQueryResult } from './types';
import { withRetry } from './utils';
import { WebSocketManager } from './websocketManager';

export class ManifestStatsServer {
  private connection: Connection;
  private wsManager: WebSocketManager | null = null;
  // Base and quote volume
  private baseVolumeAtomsSinceLastCheckpoint: Map<string, number> = new Map();
  private quoteVolumeAtomsSinceLastCheckpoint: Map<string, number> = new Map();

  // Hourly checkpoints
  private baseVolumeAtomsCheckpoints: Map<string, number[]> = new Map();
  private quoteVolumeAtomsCheckpoints: Map<string, number[]> = new Map();
  
  // Unix timestamps for each checkpoint (in seconds)
  private checkpointTimestamps: Map<string, number[]> = new Map();

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
  private pool: Pool;
  private isReadOnly: boolean;
  private startTime: number;

  // Prometheus metrics
  private fills: promClient.Counter<'market'>;
  private reconnects: promClient.Counter<string>;
  private volume: promClient.Gauge<'market' | 'mint' | 'side'>;
  private lastPrice: promClient.Gauge<'market'>;
  private depth: promClient.Gauge<'depth_bps' | 'market' | 'trader'>;

  constructor(
    rpcUrl: string,
    isReadOnly: boolean,
    databaseUrl: string | undefined,
    metrics: {
      fills: promClient.Counter<'market'>;
      reconnects: promClient.Counter<string>;
      volume: promClient.Gauge<'market' | 'mint' | 'side'>;
      lastPrice: promClient.Gauge<'market'>;
      depth: promClient.Gauge<'depth_bps' | 'market' | 'trader'>;
    },
  ) {
    this.isReadOnly = isReadOnly;
    this.startTime = Date.now();
    this.connection = new Connection(rpcUrl);
    this.fills = metrics.fills;
    this.reconnects = metrics.reconnects;
    this.volume = metrics.volume;
    this.lastPrice = metrics.lastPrice;
    this.depth = metrics.depth;

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }, // May be needed depending on Fly Postgres configuration
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
      // Continue operation - don't let DB errors crash the server
    });

    this.initWebSocket();

    // Only initialize database schema if not in read-only mode
    if (!this.isReadOnly) {
      this.initDatabase();
    }
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
    if (this.isReadOnly) {
      return; // Skip database writes in read-only mode
    }

    try {
      await withRetry(async () => {
        await this.pool.query(queries.INSERT_FILL_COMPLETE, [
          fill.slot,
          fill.market,
          fill.signature,
          fill.taker,
          fill.maker,
          fill.takerSequenceNumber,
          fill.makerSequenceNumber,
          JSON.stringify(fill),
        ]);
      });
    } catch (error) {
      console.error('Error saving complete fill to database:', error);
      // Don't throw - fire and forget
    }
  }

  private async processFillAsync(fill: FillLogResult): Promise<void> {
    try {
      const { market, baseAtoms, quoteAtoms, priceAtoms, taker, maker } = fill;

      // Use originalSigner if available (it's optional in FillLogResult)
      const originalSigner = (fill as any).originalSigner;
      const actualTaker = resolveActualTrader(taker, originalSigner);

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
      this.lastPrice.set(
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
      this.checkpointTimestamps.set(
        market,
        new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
      );

      const marketPk = new PublicKey(market);
      const marketObject = await Market.loadFromAddress({
        connection: this.connection,
        address: marketPk,
      });

      this.markets.set(market, marketObject);
      const baseSymbol = await lookupMintTicker(
        this.connection,
        marketObject.baseMint(),
      );
      const quoteSymbol = await lookupMintTicker(
        this.connection,
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

    if (STABLECOIN_MINTS.has(quoteMint)) {
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
    } else if (quoteMint === SOL_MINT) {
      const { solPrice } = this.getSolAndBtcPrices();
      if (solPrice > 0) {
        const notionalVolume =
          (Number(quoteAtoms) / 10 ** marketObject.quoteDecimals()) * solPrice;

        this.traderTakerNotionalVolume.set(
          actualTaker,
          this.traderTakerNotionalVolume.get(actualTaker)! + notionalVolume,
        );
        this.traderMakerNotionalVolume.set(
          maker,
          this.traderMakerNotionalVolume.get(maker)! + notionalVolume,
        );
      }
    } else if (quoteMint === CBBTC_MINT || quoteMint === WBTC_MINT) {
      const { cbbtcPrice } = this.getSolAndBtcPrices();
      if (cbbtcPrice > 0) {
        const notionalVolume =
          (Number(quoteAtoms) / 10 ** marketObject.quoteDecimals()) *
          cbbtcPrice;

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

  private initWebSocket(): void {
    this.wsManager = new WebSocketManager({
      url: 'wss://mfx-feed-mainnet.fly.dev',
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 30000,
      connectionTimeout: 10000,
      onMessage: (fill: FillLogResult) => {
        this.fillMutex.runExclusive(async () => {
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

          this.fills.inc({ market });
          console.log('Got fill', fill);

          await this.processFillAsync(fill);

          // Queue for background processing to avoid waiting for db operation.
          setImmediate(() => this.saveCompleteFillToDatabase(fill));
        });
      },
      onConnect: () => {
        console.log('WebSocket connected to fill feed');
      },
      onDisconnect: (code, reason) => {
        console.log(
          `WebSocket disconnected from fill feed: ${code} - ${reason}`,
        );
        this.reconnects.inc();
      },
      onError: (error) => {
        console.error('WebSocket error:', error);
        this.reconnects.inc();
      },
      onReconnectAttempt: (attempt) => {
        console.log(
          `Attempting to reconnect to fill feed (attempt ${attempt})`,
        );
      },
    });

    this.wsManager.connect();
  }

  /**
   * Initialize at the start with a get program accounts.
   */
  async initialize(): Promise<void> {
    await this.loadState();

    const marketProgramAccounts: GetProgramAccountsResponse =
      await fetchMarketProgramAccounts(this.connection);

    marketProgramAccounts.forEach(
      (
        value: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>,
      ) => {
        const marketPk: string = value.pubkey.toBase58();

        // If we have account data, load the market and check volume
        if (value.account.data.length > 0) {
          try {
            const market: Market = Market.loadFromBuffer({
              buffer: value.account.data,
              address: new PublicKey(marketPk),
            });

            // Skip markets that have never traded to keep the amount of data
            // retention smaller.
            if (Number(market.quoteVolume()) == 0) {
              return;
            }

            this.markets.set(marketPk, market);
          } catch (err) {
            console.error(`Failed to load market ${marketPk}:`, err);
            // Continue with other markets
            return;
          }
        }

        // Initialize checkpoints regardless of whether we have market data
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
          this.checkpointTimestamps.set(
            marketPk,
            new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
          );
        }
      },
    );

    const mintToSymbols: Map<string, string> = new Map();
    this.markets.forEach(async (market: Market) => {
      const baseMint: PublicKey = market.baseMint();
      const quoteMint: PublicKey = market.quoteMint();

      let baseSymbol = '';
      let quoteSymbol = '';
      if (mintToSymbols.has(baseMint.toBase58())) {
        baseSymbol = mintToSymbols.get(baseMint.toBase58())!;
      } else {
        // Sleep to backoff on RPC load.
        await new Promise((f) => setTimeout(f, 500));
        baseSymbol = await lookupMintTicker(this.connection, baseMint);
      }
      mintToSymbols.set(baseMint.toBase58(), baseSymbol);

      if (mintToSymbols.has(quoteMint.toBase58())) {
        quoteSymbol = mintToSymbols.get(quoteMint.toBase58())!;
      } else {
        quoteSymbol = await lookupMintTicker(this.connection, quoteMint);
      }
      mintToSymbols.set(quoteMint.toBase58(), quoteSymbol);

      this.tickers.set(market.address.toBase58(), [
        mintToSymbols.get(market.baseMint()!.toBase58())!,
        mintToSymbols.get(market.quoteMint()!.toBase58())!,
      ]);
    });
  }

  /**
   * Periodically save the volume so a 24 hour rolling volume can be calculated.
   */
  async saveCheckpoints(): Promise<void> {
    this.fillMutex.runExclusive(async () => {
      console.log('Saving checkpoints');

      // Check websocket connection status - no need to reset every time
      if (this.wsManager && !this.wsManager.isConnected()) {
        console.log('WebSocket disconnected, reconnecting...');
        this.wsManager.connect();
      }

      const currentTimestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
      
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
        
        // Update checkpoint timestamps
        this.checkpointTimestamps.set(market, [
          ...this.checkpointTimestamps.get(market)!.slice(1),
          currentTimestamp,
        ]);

        const baseMint: string = value.baseMint().toBase58();
        const quoteMint: string = value.quoteMint().toBase58();
        
        // Calculate volume using only checkpoints from the last 24 hours
        const timestamps = this.checkpointTimestamps.get(market)!;
        const baseCheckpoints = this.baseVolumeAtomsCheckpoints.get(market)!;
        const quoteCheckpoints = this.quoteVolumeAtomsCheckpoints.get(market)!;
        const twentyFourHoursAgo = currentTimestamp - ONE_DAY_SEC;
        
        let baseVolume = 0;
        let quoteVolume = 0;
        
        for (let i = 0; i < timestamps.length; i++) {
          if (timestamps[i] >= twentyFourHoursAgo) {
            baseVolume += baseCheckpoints[i];
            quoteVolume += quoteCheckpoints[i];
          }
        }
        
        this.volume.set(
          { market, mint: baseMint, side: 'base' },
          baseVolume,
        );
        this.volume.set(
          { market, mint: quoteMint, side: 'quote' },
          quoteVolume,
        );
      });
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
                  this.depth.set(
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
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgo = currentTimestamp - ONE_DAY_SEC;
    
    this.markets.forEach((market: Market, marketPk: string) => {
      // Calculate volume using only checkpoints from the last 24 hours
      const timestamps = this.checkpointTimestamps.get(marketPk) || [];
      const baseCheckpoints = this.baseVolumeAtomsCheckpoints.get(marketPk) || [];
      const quoteCheckpoints = this.quoteVolumeAtomsCheckpoints.get(marketPk) || [];
      
      let baseVolumeAtoms = 0;
      let quoteVolumeAtoms = 0;
      
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= twentyFourHoursAgo) {
          baseVolumeAtoms += baseCheckpoints[i];
          quoteVolumeAtoms += quoteCheckpoints[i];
        }
      }
      
      const bids = market.bids();
      const asks = market.asks();
      const bestBid = bids.length > 0 ? bids[bids.length - 1].tokenPrice : 0;
      const bestAsk = asks.length > 0 ? asks[asks.length - 1].tokenPrice : 0;

      tickers.push({
        ticker_id: marketPk,
        base_currency: market.baseMint().toBase58(),
        target_currency: market.quoteMint().toBase58(),
        last_price:
          this.lastPriceByMarket.get(marketPk)! *
          10 ** (market.baseDecimals() - market.quoteDecimals()),
        base_volume: baseVolumeAtoms / 10 ** market.baseDecimals(),
        target_volume: quoteVolumeAtoms / 10 ** market.quoteDecimals(),
        pool_id: marketPk,
        // Does not apply to orderbooks.
        liquidity_in_usd: 0,
        bid: bestBid,
        ask: bestAsk,
        // Optional: not yet implemented
        // high: 0,
        // low: 0,
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
      const timestamp = Math.floor(Date.now() / 1000).toString();

      if (depth == 0) {
        return {
          ticker_id: tickerId,
          timestamp,
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

      // CoinGecko spec: depth = total orders, split evenly between bids/asks
      // depth=100 means 50 bids + 50 asks
      const ordersPerSide = Math.floor(depth / 2);
      const bidsUpToDepth = bids.slice(0, ordersPerSide);
      const asksUpToDepth = asks.slice(0, ordersPerSide);

      return {
        ticker_id: tickerId,
        timestamp,
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
   * Get Checkpoints
   *
   * Returns all base and quote volume checkpoints for all markets
   */
  getCheckpoints(): {
    [market: string]: {
      baseCheckpoints: number[];
      quoteCheckpoints: number[];
      timestamps: number[];
    };
  } {
    const checkpointsByMarket: {
      [market: string]: {
        baseCheckpoints: number[];
        quoteCheckpoints: number[];
        timestamps: number[];
      };
    } = {};

    this.markets.forEach((_market: Market, marketPk: string) => {
      const baseCheckpoints =
        this.baseVolumeAtomsCheckpoints.get(marketPk) || [];
      const quoteCheckpoints =
        this.quoteVolumeAtomsCheckpoints.get(marketPk) || [];
      const timestamps =
        this.checkpointTimestamps.get(marketPk) || [];

      checkpointsByMarket[marketPk] = {
        baseCheckpoints,
        quoteCheckpoints,
        timestamps,
      };
    });

    return checkpointsByMarket;
  }

  /**
   * Get Notional Volume (USD) by Market
   *
   * Returns USD notional traded on each market in the last 24 hours
   */
  async getNotional(): Promise<{ [market: string]: number }> {
    const notionalByMarket: { [market: string]: number } = {};

    // Get SOL price for converting SOL-quoted volumes to USDC equivalent
    const solPriceAtoms = this.lastPriceByMarket.get(SOL_USDC_MARKET);
    const solUsdcMarket = this.markets.get(SOL_USDC_MARKET);
    let solPrice = 0;
    if (solPriceAtoms && solUsdcMarket) {
      solPrice =
        solPriceAtoms *
        10 ** (solUsdcMarket.baseDecimals() - solUsdcMarket.quoteDecimals());
    }

    // Get CBBTC price for converting CBBTC-quoted volumes to USDC equivalent
    const cbbtcPriceAtoms = this.lastPriceByMarket.get(CBBTC_USDC_MARKET);
    const cbbtcUsdcMarket = this.markets.get(CBBTC_USDC_MARKET);
    let cbbtcPrice = 0;
    if (cbbtcPriceAtoms && cbbtcUsdcMarket) {
      cbbtcPrice =
        cbbtcPriceAtoms *
        10 **
          (cbbtcUsdcMarket.baseDecimals() - cbbtcUsdcMarket.quoteDecimals());
    }

    // Get WBTC price as fallback for BTC conversion
    const wbtcPriceAtoms = this.lastPriceByMarket.get(WBTC_USDC_MARKET);
    const wbtcUsdcMarket = this.markets.get(WBTC_USDC_MARKET);
    let wbtcPrice = 0;
    if (wbtcPriceAtoms && wbtcUsdcMarket) {
      wbtcPrice =
        wbtcPriceAtoms *
        10 ** (wbtcUsdcMarket.baseDecimals() - wbtcUsdcMarket.quoteDecimals());
    }

    // Use whichever BTC price is available (prefer CBBTC, fallback to WBTC, then CoinGecko)
    let btcPrice = cbbtcPrice > 0 ? cbbtcPrice : wbtcPrice;

    // If no BTC price available from markets, fetch from CoinGecko
    if (btcPrice === 0) {
      btcPrice = await fetchBtcPriceFromCoinGecko();
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgo = currentTimestamp - ONE_DAY_SEC;
    
    this.markets.forEach((market: Market, marketPk: string) => {
      // Calculate volume using only checkpoints from the last 24 hours
      const timestamps = this.checkpointTimestamps.get(marketPk) || [];
      const quoteCheckpoints = this.quoteVolumeAtomsCheckpoints.get(marketPk) || [];
      
      let checkpointsVolume = 0;
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= twentyFourHoursAgo) {
          checkpointsVolume += quoteCheckpoints[i];
        }
      }
      
      // Include both the checkpoints AND the volume since last checkpoint
      const currentPeriodVolume =
        this.quoteVolumeAtomsSinceLastCheckpoint.get(marketPk) || 0;
      const totalVolumeAtoms = checkpointsVolume + currentPeriodVolume;

      const quoteVolume: number =
        totalVolumeAtoms / 10 ** market.quoteDecimals();

      if (quoteVolume === 0) {
        return;
      }

      const quoteMint = market.quoteMint().toBase58();

      // Track stablecoin quote volume directly (USDC, USDT, PYUSD, USDS, USD1)
      if (STABLECOIN_MINTS.has(quoteMint)) {
        notionalByMarket[marketPk] = quoteVolume;
        return;
      }

      // Convert SOL quote volume to USDC equivalent
      if (quoteMint === SOL_MINT && solPrice > 0) {
        notionalByMarket[marketPk] = quoteVolume * solPrice;
        return;
      }

      // Convert CBBTC/WBTC quote volume to USDC equivalent
      if (
        (quoteMint === CBBTC_MINT || quoteMint === WBTC_MINT) &&
        btcPrice > 0
      ) {
        notionalByMarket[marketPk] = quoteVolume * btcPrice;
        return;
      }

      // If we can't convert to USD, don't include it
    });

    return notionalByMarket;
  }

  /**
   * Get normalized SOL and BTC prices
   * @returns Object containing solPrice and cbbtcPrice (both normalized to USDC)
   */
  private getSolAndBtcPrices(): { solPrice: number; cbbtcPrice: number } {
    let solPrice = 0;
    let cbbtcPrice = 0;

    // Get SOL price for converting SOL-quoted volumes to USDC equivalent
    const solPriceAtoms = this.lastPriceByMarket.get(SOL_USDC_MARKET);
    const solUsdcMarket = this.markets.get(SOL_USDC_MARKET);
    if (solPriceAtoms && solUsdcMarket) {
      solPrice =
        solPriceAtoms *
        10 ** (solUsdcMarket.baseDecimals() - solUsdcMarket.quoteDecimals());
    }

    // Get CBBTC price for converting CBBTC-quoted volumes to USDC equivalent
    const cbbtcPriceAtoms = this.lastPriceByMarket.get(CBBTC_USDC_MARKET);
    const cbbtcUsdcMarket = this.markets.get(CBBTC_USDC_MARKET);
    if (cbbtcPriceAtoms && cbbtcUsdcMarket) {
      cbbtcPrice =
        cbbtcPriceAtoms *
        10 **
          (cbbtcUsdcMarket.baseDecimals() - cbbtcUsdcMarket.quoteDecimals());
    }

    return { solPrice, cbbtcPrice };
  }

  /**
   * Get Volume
   *
   * https://docs.llama.fi/list-your-project/other-dashboards/dimensions
   */
  async getVolume() {
    let marketProgramAccounts: GetProgramAccountsResponse;
    let lifetimeVolume = 0;

    // Get normalized SOL and BTC prices
    const { solPrice, cbbtcPrice } = this.getSolAndBtcPrices();

    try {
      marketProgramAccounts = await ManifestClient.getMarketProgramAccounts(
        this.connection,
      );

      lifetimeVolume = getLifetimeVolumeForMarkets(
        marketProgramAccounts,
        solPrice,
        cbbtcPrice,
      );
    } catch (error) {
      console.error(
        'Failed to get market program accounts for volume calculation:',
        error,
      );
      // Return zero lifetime volume on error.
      lifetimeVolume = 0;
    }

    const dailyVolumesByToken: Map<string, number> = new Map();
    let dailyUsdcEquivalentVolume = 0;
    let dailyDirectUsdcVolume = 0;
    
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgo = currentTimestamp - ONE_DAY_SEC;

    this.markets.forEach((market: Market, marketPk: string) => {
      // Calculate volume using only checkpoints from the last 24 hours
      const timestamps = this.checkpointTimestamps.get(marketPk) || [];
      const baseCheckpoints = this.baseVolumeAtomsCheckpoints.get(marketPk) || [];
      const quoteCheckpoints = this.quoteVolumeAtomsCheckpoints.get(marketPk) || [];
      
      let baseVolumeAtoms = 0;
      let quoteVolumeAtoms = 0;
      
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= twentyFourHoursAgo) {
          baseVolumeAtoms += baseCheckpoints[i];
          quoteVolumeAtoms += quoteCheckpoints[i];
        }
      }
      
      const baseVolume: number = baseVolumeAtoms / 10 ** market.baseDecimals();
      const quoteVolume: number = quoteVolumeAtoms / 10 ** market.quoteDecimals();
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
      if (market.quoteMint().toBase58() != USDC_MINT) {
        if (!dailyVolumesByToken.has(quoteMint)) {
          dailyVolumesByToken.set(quoteMint, 0);
        }
        dailyVolumesByToken.set(
          quoteMint,
          dailyVolumesByToken.get(quoteMint)! + quoteVolume,
        );
      }

      // Calculate total USDC equivalent volume
      if (market.quoteMint().toBase58() == SOL_MINT && solPrice > 0) {
        dailyUsdcEquivalentVolume += quoteVolume * solPrice;
      } else if (market.quoteMint().toBase58() == USDC_MINT) {
        dailyDirectUsdcVolume += quoteVolume;
        dailyUsdcEquivalentVolume += quoteVolume;
      }
    });

    // Report direct USDC volume separately and combined volume under USDC key
    const usdcKey = 'solana:' + USDC_MINT;
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
  getTraders(
    includeDebug: boolean = false,
    limit: number = 500,
  ): {
    [key: string]: {
      taker: number;
      maker: number;
      takerNotionalVolume: number;
      makerNotionalVolume: number;
      pnl: number;
      _debug?: any;
    };
  } {
    const allTraders = new Set<string>([
      ...Array.from(this.traderNumTakerTrades.keys()),
      ...Array.from(this.traderNumMakerTrades.keys()),
    ]);

    // Sort traders by total volume to get the most active ones
    const tradersByVolume = Array.from(allTraders)
      .map((trader) => ({
        trader,
        totalVolume:
          (this.traderTakerNotionalVolume.get(trader) || 0) +
          (this.traderMakerNotionalVolume.get(trader) || 0),
      }))
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, limit); // Only process top N traders

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

    tradersByVolume.forEach(({ trader }) => {
      const takerNotionalVolume =
        this.traderTakerNotionalVolume.get(trader) || 0;
      const makerNotionalVolume =
        this.traderMakerNotionalVolume.get(trader) || 0;

      const pnlResult = calculateTraderPnL(
        trader,
        this.traderPositions,
        this.traderAcquisitionValue,
        this.markets,
        this.lastPriceByMarket,
        includeDebug,
      );

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
    const response = await this.pool.query(queries.SELECT_ALT_MARKETS);
    return response.rows.map((r) => ({ alt: r.alt, market: r.market }));
  }

  /**
   * Get array of recent fills.
   */
  getRecentFills(market: string) {
    return { [market]: this.fillLogResults.get(market) };
  }

  async getCompleteFillsFromDatabase(
    options: CompleteFillsQueryOptions = {},
  ): Promise<CompleteFillsQueryResult> {
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
      await this.pool.query(queries.CREATE_STATE_CHECKPOINTS_TABLE);
      await this.pool.query(queries.CREATE_MARKET_VOLUMES_TABLE);
      await this.pool.query(queries.CREATE_MARKET_CHECKPOINTS_TABLE);
      await this.pool.query(queries.CREATE_TRADER_STATS_TABLE);
      await this.pool.query(queries.CREATE_FILL_LOG_RESULTS_TABLE);
      await this.pool.query(queries.CREATE_TRADER_POSITIONS_TABLE);
      await this.pool.query(queries.CREATE_FILLS_COMPLETE_TABLE);
      await this.pool.query(queries.CREATE_FILLS_COMPLETE_INDEXES);
      await this.pool.query(queries.CREATE_ALT_MARKETS_TABLE);

      // Run migrations for existing tables
      await this.pool.query(queries.ALTER_MARKET_CHECKPOINTS_ADD_TIMESTAMPS);

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
    if (this.isReadOnly) {
      console.log('Skipping state save (read-only mode)');
      return;
    }

    console.log('Saving state to database...');

    let client;
    try {
      console.log('Getting db client');
      client = await this.pool.connect();

      // Add error handler to prevent unhandled errors from crashing the server
      client.on('error', (err) => {
        console.error('Database client error:', err);
      });

      // Start a transaction
      console.log('Querying begin');
      await client.query(queries.BEGIN_TRANSACTION);

      // Insert a new checkpoint
      console.log('Inserting checkpoint');
      const checkpointResult = await client.query(
        queries.INSERT_STATE_CHECKPOINT,
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
          client.query(queries.INSERT_MARKET_VOLUME, [
            checkpointId,
            market,
            baseVolume,
            quoteVolume,
          ]),
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
        const checkpointTimestamps =
          this.checkpointTimestamps.get(market) || [];
        const lastPrice = this.lastPriceByMarket.get(market) || 0;

        checkpointPromises.push(
          client.query(queries.INSERT_MARKET_CHECKPOINT, [
            checkpointId,
            market,
            JSON.stringify(baseCheckpoints),
            JSON.stringify(quoteCheckpoints),
            JSON.stringify(checkpointTimestamps),
            lastPrice,
          ]),
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
            client.query(queries.INSERT_TRADER_STATS, [
              checkpointId,
              trader,
              numTakerTrades,
              numMakerTrades,
              takerVolume,
              makerVolume,
            ]),
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
            client.query(queries.INSERT_TRADER_POSITION, [
              checkpointId,
              trader,
              mint,
              position,
              acquisitionValue,
            ]),
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
      await client.query(queries.DELETE_OLD_CHECKPOINTS, [checkpointId]);

      console.log('Committing');
      await client.query(queries.COMMIT_TRANSACTION);
      console.log('State saved successfully to database');
    } catch (error) {
      console.error('Error saving state to database:', error);
      if (client) {
        try {
          await client.query(queries.ROLLBACK_TRANSACTION);
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
      // Get the most recent checkpoint
      const checkpointResultRecent = await this.pool.query(
        queries.SELECT_RECENT_CHECKPOINT,
      );

      if (checkpointResultRecent.rowCount === 0) {
        console.log('No saved state found in database');
        return false;
      }

      const checkpointId = checkpointResultRecent.rows[0].id;
      this.lastFillSlot = checkpointResultRecent.rows[0].last_fill_slot;

      // Load market volumes
      const volumeResult = await this.pool.query(
        queries.SELECT_MARKET_VOLUMES,
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
        queries.SELECT_MARKET_CHECKPOINTS,
        [checkpointId],
      );

      for (const row of checkpointResult.rows) {
        let baseCheckpoints = JSON.parse(row.base_volume_checkpoints_text);
        let quoteCheckpoints = JSON.parse(row.quote_volume_checkpoints_text);
        let checkpointTimestamps = row.checkpoint_timestamps_text 
          ? JSON.parse(row.checkpoint_timestamps_text)
          : new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0);

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

        if (!Array.isArray(checkpointTimestamps)) {
          console.log(
            `Checkpoint timestamps for market ${row.market} is not an array, converting`,
          );
          checkpointTimestamps = Object.values(checkpointTimestamps);
        }

        this.baseVolumeAtomsCheckpoints.set(row.market, baseCheckpoints);
        this.quoteVolumeAtomsCheckpoints.set(row.market, quoteCheckpoints);
        this.checkpointTimestamps.set(row.market, checkpointTimestamps);
        this.lastPriceByMarket.set(row.market, Number(row.last_price));
      }

      // Load trader stats
      const traderResult = await this.pool.query(queries.SELECT_TRADER_STATS, [
        checkpointId,
      ]);

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
        queries.SELECT_TRADER_POSITIONS,
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
        queries.SELECT_FILL_LOG_RESULTS,
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

  /**
   * Clean shutdown of the server
   */
  public async shutdown(): Promise<void> {
    console.log('Shutting down ManifestStatsServer...');

    // Close WebSocket connection
    if (this.wsManager) {
      this.wsManager.close();
      this.wsManager = null;
    }

    // Close database pool
    if (this.pool) {
      await this.pool.end();
    }

    console.log('ManifestStatsServer shutdown complete');
  }
}
