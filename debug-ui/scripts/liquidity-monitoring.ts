import 'dotenv/config';

import { Connection, GetProgramAccountsResponse } from '@solana/web3.js';
import { ManifestClient, Market } from '@cks-systems/manifest-sdk';
import { Pool } from 'pg';
import * as promClient from 'prom-client';
import express from 'express';
import promBundle from 'express-prom-bundle';
import cors from 'cors';

// Configuration constants
const MONITORING_INTERVAL_MS = 60 * 1000; // 1 minutes
const MIN_VOLUME_THRESHOLD_USD = 10_000; // $10k minimum 24hr volume
const SPREAD_BPS = [10, 50, 100, 200]; // 0.1%, 0.5%, 1%, 2%
const MIN_NOTIONAL_USD = 10; // $10 minimum total notional to be considered a market maker
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PORT = 3001;

// Environment variables
const { RPC_URL, DATABASE_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL missing from env');
}

// Prometheus metrics
const marketMakerDepth = new promClient.Gauge({
  name: 'market_maker_depth',
  help: 'Market maker depth at various spreads',
  labelNames: ['market', 'trader', 'side', 'spread_bps'] as const,
});

const marketMakerUptime = new promClient.Gauge({
  name: 'market_maker_uptime',
  help: 'Market maker uptime percentage over last 24 hours',
  labelNames: ['market', 'trader'] as const,
});

const marketVolume24h = new promClient.Gauge({
  name: 'market_volume_24h',
  help: '24 hour volume in USD for markets',
  labelNames: ['market'] as const,
});

interface MarketMakerStats {
  trader: string;
  market: string;
  bidDepth: { [spreadBps: number]: number };
  askDepth: { [spreadBps: number]: number };
  totalNotionalUsd: number;
  isActive: boolean;
  timestamp: Date;
}

interface MarketInfo {
  address: string;
  baseMint: string;
  quoteMint: string;
  volume24hUsd: number;
  lastPrice: number;
  baseDecimals: number;
  quoteDecimals: number;
}

export class LiquidityMonitor {
  private connection: Connection;
  private pool: Pool;
  private markets: Map<string, Market> = new Map();
  private marketInfo: Map<string, MarketInfo> = new Map();

  constructor() {
    this.connection = new Connection(RPC_URL!);
    this.pool = new Pool({
      connectionString: DATABASE_URL!,
      ssl: { rejectUnauthorized: false },
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }

  /**
   * Initialize database schema
   */
  async initDatabase(): Promise<void> {
    try {
      // Market maker stats table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS market_maker_stats (
          id SERIAL PRIMARY KEY,
          market TEXT NOT NULL,
          trader TEXT NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN NOT NULL,
          total_notional_usd NUMERIC DEFAULT 0,
          bid_depth_10_bps NUMERIC DEFAULT 0,
          bid_depth_50_bps NUMERIC DEFAULT 0,
          bid_depth_100_bps NUMERIC DEFAULT 0,
          bid_depth_200_bps NUMERIC DEFAULT 0,
          ask_depth_10_bps NUMERIC DEFAULT 0,
          ask_depth_50_bps NUMERIC DEFAULT 0,
          ask_depth_100_bps NUMERIC DEFAULT 0,
          ask_depth_200_bps NUMERIC DEFAULT 0
        )
      `);

      // Market info table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS market_info_snapshots (
          id SERIAL PRIMARY KEY,
          market TEXT NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          volume_24h_usd NUMERIC NOT NULL,
          last_price NUMERIC NOT NULL,
          total_unique_makers INTEGER DEFAULT 0,
          avg_bid_depth NUMERIC DEFAULT 0,
          avg_ask_depth NUMERIC DEFAULT 0
        )
      `);

      // Market maker summary table for efficient querying
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS market_maker_summary (
          market TEXT NOT NULL,
          trader TEXT NOT NULL,
          last_active TIMESTAMP WITH TIME ZONE,
          uptime_24h NUMERIC DEFAULT 0,
          avg_bid_depth_100_bps NUMERIC DEFAULT 0,
          avg_ask_depth_100_bps NUMERIC DEFAULT 0,
          total_samples_24h INTEGER DEFAULT 0,
          active_samples_24h INTEGER DEFAULT 0,
          PRIMARY KEY (market, trader)
        )
      `);

      // Create indexes for performance
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_market_maker_stats_timestamp 
        ON market_maker_stats(timestamp)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_market_maker_stats_market_trader 
        ON market_maker_stats(market, trader)
      `);

      console.log('Database schema initialized');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }

  /**
   * Fetch market volume data from the stats API
   */
  async fetchMarketVolumes(): Promise<Map<string, number>> {
    try {
      const response = await fetch('https://mfx-stats-mainnet.fly.dev/tickers');
      const tickers = await response.json();

      const volumeMap = new Map<string, number>();

      for (const ticker of tickers) {
        const quoteMint = ticker.target_currency;
        if (quoteMint !== USDC_MINT) {
          continue;
        }
        // Convert to USD using quote volume (assuming USDC quote)
        const volumeUsd = ticker.target_volume || 0;
        volumeMap.set(ticker.ticker_id, volumeUsd);
      }

      return volumeMap;
    } catch (error) {
      console.error('Error fetching market volumes:', error);
      return new Map();
    }
  }

  /**
   * Load eligible markets (>$10k 24hr volume and USDC quote)
   */
  async loadEligibleMarkets(): Promise<void> {
    console.log('Loading eligible markets...');

    const volumeMap = await this.fetchMarketVolumes();
    const marketProgramAccounts: GetProgramAccountsResponse =
      await ManifestClient.getMarketProgramAccounts(this.connection);

    this.markets.clear();
    this.marketInfo.clear();

    for (const account of marketProgramAccounts) {
      const marketPk = account.pubkey.toBase58();
      const volume24h = volumeMap.get(marketPk) || 0;

      if (volume24h >= MIN_VOLUME_THRESHOLD_USD) {
        try {
          const market = Market.loadFromBuffer({
            buffer: account.account.data,
            address: account.pubkey,
          });

          // Skip markets that have never traded
          if (Number(market.quoteVolume()) === 0) {
            continue;
          }

          // Only include USDC quote markets
          const quoteMint = market.quoteMint().toBase58();
          if (quoteMint !== USDC_MINT) {
            continue;
          }

          this.markets.set(marketPk, market);

          this.marketInfo.set(marketPk, {
            address: marketPk,
            baseMint: market.baseMint().toBase58(),
            quoteMint: quoteMint,
            volume24hUsd: volume24h,
            lastPrice: 0, // Will be updated during monitoring
            baseDecimals: market.baseDecimals(),
            quoteDecimals: market.quoteDecimals(),
          });

          console.log(
            `Added USDC market ${marketPk} with ${volume24h.toLocaleString()} 24h volume`,
          );
        } catch (error) {
          console.error(`Error loading market ${marketPk}:`, error);
        }
      }
    }

    console.log(`Loaded ${this.markets.size} eligible USDC markets`);
  }

  /**
   * Calculate market maker depths at various spreads
   */
  calculateMarketMakerDepths(market: Market): MarketMakerStats[] {
    const bids = market.bids();
    const asks = market.asks();

    console.log(
      `Market ${market.address.toBase58()}: ${bids.length} bids, ${asks.length} asks`,
    );

    if (bids.length === 0 || asks.length === 0) {
      console.log(
        `Skipping market ${market.address.toBase58()}: no bids or asks`,
      );
      return [];
    }

    // Calculate mid price
    const bestBid = bids[bids.length - 1].tokenPrice;
    const bestAsk = asks[asks.length - 1].tokenPrice;
    const midPrice = (bestBid + bestAsk) / 2;

    console.log(
      `Market ${market.address.toBase58()}: bestBid=${bestBid}, bestAsk=${bestAsk}, midPrice=${midPrice}`,
    );

    // Track unique traders
    const traders = new Set<string>();
    [...bids, ...asks].forEach((order) => traders.add(order.trader.toBase58()));

    console.log(
      `Market ${market.address.toBase58()}: ${traders.size} unique traders found`,
    );

    const stats: MarketMakerStats[] = [];
    let filteredCount = 0;

    for (const trader of traders) {
      const traderBids = bids.filter(
        (order) => order.trader.toBase58() === trader,
      );
      const traderAsks = asks.filter(
        (order) => order.trader.toBase58() === trader,
      );

      console.log(
        `Trader ${trader}: ${traderBids.length} bids, ${traderAsks.length} asks`,
      );

      const bidDepth: { [spreadBps: number]: number } = {};
      const askDepth: { [spreadBps: number]: number } = {};

      // Calculate depth at each spread level
      for (const spreadBps of SPREAD_BPS) {
        const spreadMultiplier = spreadBps / 10000; // Convert bps to decimal
        const bidThreshold = midPrice * (1 - spreadMultiplier);
        const askThreshold = midPrice * (1 + spreadMultiplier);

        // Calculate bid depth (orders above threshold)
        bidDepth[spreadBps] = traderBids
          .filter((order) => order.tokenPrice >= bidThreshold)
          .reduce((sum, order) => sum + Number(order.numBaseTokens), 0);

        // Calculate ask depth (orders below threshold)
        askDepth[spreadBps] = traderAsks
          .filter((order) => order.tokenPrice <= askThreshold)
          .reduce((sum, order) => sum + Number(order.numBaseTokens), 0);
      }

      // Calculate total notional in USD (using 100bps depth as representative)
      const totalBaseTokens = (bidDepth[100] || 0) + (askDepth[100] || 0);
      const totalNotionalUsd = totalBaseTokens * midPrice;

      console.log(
        `Trader ${trader}: totalBaseTokens=${totalBaseTokens}, midPrice=${midPrice}, totalNotionalUsd=${totalNotionalUsd}`,
      );

      // Only include if they meet minimum notional threshold
      if (totalNotionalUsd < MIN_NOTIONAL_USD) {
        console.log(
          `Trader ${trader}: Filtered out (notional ${totalNotionalUsd} < ${MIN_NOTIONAL_USD})`,
        );
        filteredCount++;
        continue;
      }

      const isActive = traderBids.length > 0 || traderAsks.length > 0;

      console.log(
        `Trader ${trader}: QUALIFIED with ${totalNotionalUsd} USD notional, active=${isActive}`,
      );

      stats.push({
        trader,
        market: market.address.toBase58(),
        bidDepth,
        askDepth,
        totalNotionalUsd,
        isActive,
        timestamp: new Date(),
      });
    }

    console.log(
      `Market ${market.address.toBase58()}: ${stats.length} qualified market makers, ${filteredCount} filtered out`,
    );
    return stats;
  }

  /**
   * Monitor all eligible markets
   */
  async monitorMarkets(): Promise<void> {
    console.log('Starting market monitoring cycle...');

    const allStats: MarketMakerStats[] = [];

    for (const [marketPk, market] of this.markets) {
      try {
        // Reload market data
        await market.reload(this.connection);

        // Calculate market maker stats
        const marketStats = this.calculateMarketMakerDepths(market);
        allStats.push(...marketStats);

        // Update last price in market info
        const bids = market.bids();
        const asks = market.asks();
        if (bids.length > 0 && asks.length > 0) {
          const bestBid = bids[bids.length - 1].tokenPrice;
          const bestAsk = asks[asks.length - 1].tokenPrice;
          const lastPrice = (bestBid + bestAsk) / 2;

          const marketInfo = this.marketInfo.get(marketPk)!;
          marketInfo.lastPrice = lastPrice;

          // Update Prometheus metrics
          marketVolume24h.set({ market: marketPk }, marketInfo.volume24hUsd);
        }

        // Update Prometheus metrics for market makers
        for (const stat of marketStats) {
          for (const spreadBps of SPREAD_BPS) {
            marketMakerDepth.set(
              {
                market: marketPk,
                trader: stat.trader,
                side: 'bid',
                spread_bps: spreadBps.toString(),
              },
              stat.bidDepth[spreadBps] || 0,
            );
            marketMakerDepth.set(
              {
                market: marketPk,
                trader: stat.trader,
                side: 'ask',
                spread_bps: spreadBps.toString(),
              },
              stat.askDepth[spreadBps] || 0,
            );
          }
        }

        console.log(
          `Processed ${marketStats.length} market makers for market ${marketPk}`,
        );
      } catch (error) {
        console.error(`Error monitoring market ${marketPk}:`, error);
      }
    }

    // Save stats to database
    await this.saveStatsToDatabase(allStats);

    // Update summary statistics
    await this.updateMarketMakerSummaries();

    console.log(
      `Monitoring cycle complete. Processed ${allStats.length} total market maker entries.`,
    );
  }

  /**
   * Save market maker stats to database
   */
  async saveStatsToDatabase(stats: MarketMakerStats[]): Promise<void> {
    if (stats.length === 0) return;

    try {
      console.log('Saving market maker stats to database...');

      // Batch insert market maker stats
      const batchSize = 100;
      for (let i = 0; i < stats.length; i += batchSize) {
        const batch = stats.slice(i, i + batchSize);

        const values = batch.flatMap((stat) => [
          stat.market,
          stat.trader,
          stat.timestamp,
          stat.isActive,
          stat.totalNotionalUsd,
          stat.bidDepth[10] || 0,
          stat.bidDepth[50] || 0,
          stat.bidDepth[100] || 0,
          stat.bidDepth[200] || 0,
          stat.askDepth[10] || 0,
          stat.askDepth[50] || 0,
          stat.askDepth[100] || 0,
          stat.askDepth[200] || 0,
        ]);

        const placeholders = batch
          .map((_, index) => {
            const offset = index * 13;
            return `(${offset + 1}, ${offset + 2}, ${offset + 3}, ${offset + 4}, ${offset + 5}, ${offset + 6}, ${offset + 7}, ${offset + 8}, ${offset + 9}, ${offset + 10}, ${offset + 11}, ${offset + 12}, ${offset + 13})`;
          })
          .join(', ');

        const query = `
          INSERT INTO market_maker_stats (
            market, trader, timestamp, is_active, total_notional_usd,
            bid_depth_10_bps, bid_depth_50_bps, bid_depth_100_bps, bid_depth_200_bps,
            ask_depth_10_bps, ask_depth_50_bps, ask_depth_100_bps, ask_depth_200_bps
          ) VALUES ${placeholders}
        `;

        await this.pool.query(query, values);
      }

      // Save market info snapshots
      const marketInfoValues = Array.from(this.marketInfo.values()).flatMap(
        (info) => [info.address, new Date(), info.volume24hUsd, info.lastPrice],
      );

      if (marketInfoValues.length > 0) {
        const marketInfoPlaceholders = Array.from(this.marketInfo.values())
          .map((_, index) => {
            const offset = index * 4;
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
          })
          .join(', ');

        const marketInfoQuery = `
          INSERT INTO market_info_snapshots (market, timestamp, volume_24h_usd, last_price)
          VALUES ${marketInfoPlaceholders}
        `;

        await this.pool.query(marketInfoQuery, marketInfoValues);
      }

      console.log('Successfully saved stats to database');
    } catch (error) {
      console.error('Error saving stats to database:', error);
    }
  }

  /**
   * Update market maker summary statistics
   */
  async updateMarketMakerSummaries(): Promise<void> {
    try {
      console.log('Updating market maker summaries...');

      const query = `
        WITH recent_stats AS (
          SELECT 
            market,
            trader,
            timestamp,
            is_active,
            total_notional_usd,
            bid_depth_100_bps,
            ask_depth_100_bps
          FROM market_maker_stats
          WHERE timestamp > NOW() - INTERVAL '24 hours'
            AND total_notional_usd >= ${MIN_NOTIONAL_USD}
        ),
        summary_stats AS (
          SELECT 
            market,
            trader,
            MAX(timestamp) as last_active,
            COUNT(*) as total_samples_24h,
            COUNT(*) FILTER (WHERE is_active) as active_samples_24h,
            CASE 
              WHEN COUNT(*) > 0 THEN 
                (COUNT(*) FILTER (WHERE is_active)::NUMERIC / COUNT(*)) * 100
              ELSE 0 
            END as uptime_24h,
            -- Only calculate averages when active (non-zero depth)
            AVG(bid_depth_100_bps) FILTER (WHERE is_active AND bid_depth_100_bps > 0) as avg_bid_depth_100_bps,
            AVG(ask_depth_100_bps) FILTER (WHERE is_active AND ask_depth_100_bps > 0) as avg_ask_depth_100_bps
          FROM recent_stats
          GROUP BY market, trader
        )
        INSERT INTO market_maker_summary (
          market, trader, last_active, uptime_24h, 
          avg_bid_depth_100_bps, avg_ask_depth_100_bps,
          total_samples_24h, active_samples_24h
        )
        SELECT 
          market, trader, last_active, uptime_24h,
          COALESCE(avg_bid_depth_100_bps, 0),
          COALESCE(avg_ask_depth_100_bps, 0),
          total_samples_24h, active_samples_24h
        FROM summary_stats
        ON CONFLICT (market, trader) DO UPDATE SET
          last_active = EXCLUDED.last_active,
          uptime_24h = EXCLUDED.uptime_24h,
          avg_bid_depth_100_bps = EXCLUDED.avg_bid_depth_100_bps,
          avg_ask_depth_100_bps = EXCLUDED.avg_ask_depth_100_bps,
          total_samples_24h = EXCLUDED.total_samples_24h,
          active_samples_24h = EXCLUDED.active_samples_24h
      `;

      await this.pool.query(query);

      // Update Prometheus uptime metrics
      const uptimeQuery = `
        SELECT market, trader, uptime_24h 
        FROM market_maker_summary 
        WHERE uptime_24h > 0
      `;

      const uptimeResult = await this.pool.query(uptimeQuery);
      for (const row of uptimeResult.rows) {
        marketMakerUptime.set(
          { market: row.market, trader: row.trader },
          Number(row.uptime_24h),
        );
      }

      console.log('Successfully updated market maker summaries');
    } catch (error) {
      console.error('Error updating market maker summaries:', error);
    }
  }

  /**
   * Get market maker leaderboard
   */
  async getMarketMakerLeaderboard(market?: string): Promise<any[]> {
    try {
      let query = `
        SELECT 
          mms.*,
          mis.volume_24h_usd,
          mis.last_price
        FROM market_maker_summary mms
        LEFT JOIN LATERAL (
          SELECT volume_24h_usd, last_price
          FROM market_info_snapshots mis_inner
          WHERE mis_inner.market = mms.market
          ORDER BY timestamp DESC
          LIMIT 1
        ) mis ON true
        WHERE mms.total_samples_24h > 0
      `;

      const params = [];
      if (market) {
        query += ' AND mms.market = $1';
        params.push(market);
      }

      query += ` 
        ORDER BY 
          mms.uptime_24h DESC,
          (mms.avg_bid_depth_100_bps + mms.avg_ask_depth_100_bps) DESC
        LIMIT 100
      `;

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting market maker leaderboard:', error);
      return [];
    }
  }

  /**
   * Get market statistics
   */
  async getMarketStats(): Promise<any[]> {
    try {
      const query = `
        SELECT DISTINCT ON (mis.market)
          mis.market,
          mis.volume_24h_usd,
          mis.last_price,
          mis.timestamp,
          COUNT(DISTINCT mms.trader) as unique_makers,
          AVG(mms.uptime_24h) as avg_uptime,
          SUM(mms.avg_bid_depth_100_bps + mms.avg_ask_depth_100_bps) as total_depth
        FROM market_info_snapshots mis
        LEFT JOIN market_maker_summary mms ON mis.market = mms.market
        WHERE mis.timestamp > NOW() - INTERVAL '1 hour'
        GROUP BY mis.market, mis.volume_24h_usd, mis.last_price, mis.timestamp
        ORDER BY mis.market, mis.timestamp DESC
      `;

      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error getting market stats:', error);
      return [];
    }
  }

  /**
   * Start the monitoring loop
   */
  async startMonitoring(): Promise<void> {
    console.log('Starting liquidity monitoring...');

    // Initial load
    await this.loadEligibleMarkets();
    await this.monitorMarkets();

    // Set up periodic monitoring
    setInterval(async () => {
      try {
        await this.monitorMarkets();
      } catch (error) {
        console.error('Error in monitoring cycle:', error);
      }
    }, MONITORING_INTERVAL_MS);

    // Reload eligible markets every hour
    setInterval(
      async () => {
        try {
          await this.loadEligibleMarkets();
        } catch (error) {
          console.error('Error reloading markets:', error);
        }
      },
      60 * 60 * 1000,
    );
  }
}

// API Setup
const setupAPI = (monitor: LiquidityMonitor) => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Market maker leaderboard
  app.get('/market-makers', async (req, res) => {
    const market = req.query.market as string;
    try {
      const leaderboard = await monitor.getMarketMakerLeaderboard(market);
      res.json(leaderboard);
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Market statistics
  app.get('/markets', async (req, res) => {
    try {
      const stats = await monitor.getMarketStats();
      res.json(stats);
    } catch (error) {
      console.error('Error getting market stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date() });
  });

  return app;
};

// Main execution
const main = async () => {
  // Set up Prometheus metrics
  promClient.collectDefaultMetrics({
    labels: { app: 'liquidity-monitor' },
  });

  const metricsApp = express();
  metricsApp.listen(9090);

  const promMetrics = promBundle({
    includeMethod: true,
    metricsApp,
    autoregister: false,
  });
  metricsApp.use(promMetrics);

  // Initialize monitor
  const monitor = new LiquidityMonitor();
  await monitor.initDatabase();

  // Start API server
  const app = setupAPI(monitor);
  app.listen(PORT, () => {
    console.log(`Liquidity monitor API running on port ${PORT}`);
  });

  // Start monitoring
  await monitor.startMonitoring();

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
};

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
