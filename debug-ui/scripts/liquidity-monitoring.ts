import 'dotenv/config';

import { Connection, GetProgramAccountsResponse } from '@solana/web3.js';
import { ManifestClient, Market } from '@cks-systems/manifest-sdk';
import { Pool } from 'pg';
import * as promClient from 'prom-client';
import express from 'express';
import promBundle from 'express-prom-bundle';
import cors from 'cors';

// Configuration constants
const MONITORING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_VOLUME_THRESHOLD_USD = 1_000; // $1k minimum 24hr volume
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
  help: 'Market maker uptime percentage',
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
  public pool: Pool;
  private markets: Map<string, Market> = new Map();
  private marketInfo: Map<string, MarketInfo> = new Map();

  private isMonitoring = false;

  constructor() {
    this.connection = new Connection(RPC_URL!);
    this.pool = new Pool({
      connectionString: DATABASE_URL!,
      ssl: { rejectUnauthorized: false },
      max: 3,
      min: 1,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 8000,
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

      // Create indexes for performance
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_market_maker_stats_timestamp 
        ON market_maker_stats(timestamp)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_market_maker_stats_market_trader 
        ON market_maker_stats(market, trader)
      `);

      // Add composite index for time-range queries
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_market_maker_stats_market_trader_timestamp 
        ON market_maker_stats(market, trader, timestamp)
      `);

      const constraintExists = await this.pool.query(`
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'market_maker_stats' 
        AND constraint_name = 'unique_market_trader_timestamp'
      `);

      if (constraintExists.rows.length === 0) {
        await this.pool.query(`
          ALTER TABLE market_maker_stats 
          ADD CONSTRAINT unique_market_trader_timestamp 
          UNIQUE (market, trader, timestamp)
        `);
        console.log('Added unique constraint to prevent duplicate records');
      } else {
        console.log('Unique constraint already exists');
      }

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
  calculateMarketMakerDepths(
    market: Market,
    timestamp: Date,
  ): MarketMakerStats[] {
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
        `Trader ${trader}: ${traderBids.length} bids, ${traderAsks.length} asks, totalBaseTokens=${totalBaseTokens}, midPrice=${midPrice}, totalNotionalUsd=${totalNotionalUsd}`,
      );

      // Only include if they meet minimum notional threshold
      if (totalNotionalUsd < MIN_NOTIONAL_USD) {
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
        timestamp: timestamp,
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
    if (this.isMonitoring) {
      console.log('Previous monitoring cycle still running, skipping...');
      return;
    }

    this.isMonitoring = true;

    try {
      const cycleTimestamp = new Date();
      console.log('Starting market monitoring cycle...', cycleTimestamp);

      // Track processing to detect duplicates
      const processedMarkets = new Set<string>();
      const duplicateDetection = new Map<string, number>();
      const allStats: MarketMakerStats[] = [];

      // Create snapshot to prevent concurrent modification
      const marketsSnapshot = new Map(this.markets);
      console.log(`📊 Processing ${marketsSnapshot.size} markets in snapshot`);

      for (const [marketPk, market] of marketsSnapshot) {
        try {
          // DUPLICATE DETECTION LOGGING
          if (processedMarkets.has(marketPk)) {
            const count = duplicateDetection.get(marketPk) || 1;
            duplicateDetection.set(marketPk, count + 1);
            console.error(`🚨 DUPLICATE MARKET PROCESSING DETECTED!`);
            console.error(`   Market: ${marketPk}`);
            console.error(`   Processing attempt #${count + 1}`);
            console.error(`   This should NEVER happen - investigating...`);
            
            // Log the current markets snapshot state
            console.error(`   Markets in snapshot: ${marketsSnapshot.size}`);
            console.error(`   Already processed: ${processedMarkets.size}`);
            continue; // Skip duplicate processing
          }
          
          processedMarkets.add(marketPk);
          console.log(`🔍 Processing market ${processedMarkets.size}/${marketsSnapshot.size}: ${marketPk}`);

          // Reload market data
          await market.reload(this.connection);

          // Calculate market maker stats
          const marketStats = this.calculateMarketMakerDepths(
            market,
            cycleTimestamp,
          );
          
          console.log(`   Generated ${marketStats.length} market maker entries for ${marketPk}`);
          
          // CHECK FOR DUPLICATE MARKET MAKER ENTRIES FROM SINGLE MARKET
          const statsBeforeAdd = allStats.length;
          allStats.push(...marketStats);
          const statsAfterAdd = allStats.length;
          const expectedIncrease = marketStats.length;
          const actualIncrease = statsAfterAdd - statsBeforeAdd;
          
          if (expectedIncrease !== actualIncrease) {
            console.error(`🚨 UNEXPECTED STATS ARRAY BEHAVIOR!`);
            console.error(`   Expected increase: ${expectedIncrease}`);
            console.error(`   Actual increase: ${actualIncrease}`);
          }

          // Update last price in market info
          const bids = market.bids();
          const asks = market.asks();
          if (bids.length > 0 && asks.length > 0) {
            const bestBid = bids[bids.length - 1].tokenPrice;
            const bestAsk = asks[asks.length - 1].tokenPrice;
            const lastPrice = (bestBid + bestAsk) / 2;

            const marketInfo = this.marketInfo.get(marketPk);
            if (marketInfo) {
              marketInfo.lastPrice = lastPrice;
              // Update Prometheus metrics
              marketVolume24h.set({ market: marketPk }, marketInfo.volume24hUsd);
            }
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
            `✅ Processed ${marketStats.length} market makers for market ${marketPk}`,
          );
        } catch (error) {
          console.error(`❌ Error monitoring market ${marketPk}:`, error);
        }
      }

      // FINAL DUPLICATE ANALYSIS BEFORE DATABASE SAVE
      console.log(`\n📈 CYCLE SUMMARY:`);
      console.log(`   Markets in snapshot: ${marketsSnapshot.size}`);
      console.log(`   Markets processed: ${processedMarkets.size}`);
      console.log(`   Total stats generated: ${allStats.length}`);
      
      if (duplicateDetection.size > 0) {
        console.error(`🚨 DUPLICATE MARKET PROCESSING SUMMARY:`);
        for (const [market, count] of duplicateDetection) {
          console.error(`   ${market}: processed ${count + 1} times`);
        }
      }

      // ANALYZE STATS FOR DUPLICATES
      const statsByKey = new Map<string, number>();
      const duplicateStats: MarketMakerStats[] = [];
      
      for (const stat of allStats) {
        const key = `${stat.market}|${stat.trader}|${stat.timestamp.getTime()}`;
        const existing = statsByKey.get(key) || 0;
        statsByKey.set(key, existing + 1);
        
        if (existing > 0) {
          duplicateStats.push(stat);
          console.error(`🚨 DUPLICATE STAT DETECTED:`);
          console.error(`   Market: ${stat.market}`);
          console.error(`   Trader: ${stat.trader}`);
          console.error(`   Timestamp: ${stat.timestamp.toISOString()}`);
          console.error(`   Occurrence #${existing + 1}`);
        }
      }

      // Enhanced duplicate filtering with logging
      const uniqueStats = allStats.filter((stat, index, array) => {
        return index === array.findIndex(s => 
          s.market === stat.market && 
          s.trader === stat.trader && 
          s.timestamp.getTime() === stat.timestamp.getTime()
        );
      });
      
      const duplicateCount = allStats.length - uniqueStats.length;
      if (duplicateCount > 0) {
        console.error(`🚨 FILTERED ${duplicateCount} DUPLICATE RECORDS`);
        console.error(`   Original stats: ${allStats.length}`);
        console.error(`   Unique stats: ${uniqueStats.length}`);
        console.error(`   Duplicates removed: ${duplicateCount}`);
        
        // Log details about what was duplicated
        const duplicateBreakdown = new Map<string, number>();
        for (const duplicate of duplicateStats) {
          const market = duplicate.market.slice(-8); // Last 8 chars for brevity
          const count = duplicateBreakdown.get(market) || 0;
          duplicateBreakdown.set(market, count + 1);
        }
        
        console.error(`   Duplicate breakdown by market:`);
        for (const [market, count] of duplicateBreakdown) {
          console.error(`     ...${market}: ${count} duplicates`);
        }
      } else {
        console.log(`✅ No duplicates detected in stats array`);
      }

      // Save stats to database
      await this.saveStatsToDatabase(uniqueStats, cycleTimestamp);

      // SAMPLE COUNT TRACKING - Query current sample counts after save
      console.log(`\n📊 SAMPLE COUNT TRACKING:`);
      try {
        const sampleCountQuery = `
          SELECT 
            market,
            trader,
            COUNT(*) as current_total_samples,
            COUNT(*) FILTER (WHERE is_active) as current_active_samples,
            MIN(timestamp) as first_seen,
            MAX(timestamp) as last_seen
          FROM market_maker_stats 
          WHERE timestamp > NOW() - INTERVAL '24 hours'
            AND total_notional_usd >= ${MIN_NOTIONAL_USD}
          GROUP BY market, trader
          ORDER BY current_total_samples DESC
          LIMIT 10
        `;
        
        const sampleResult = await this.pool.query(sampleCountQuery);
        
        for (const row of sampleResult.rows) {
          const marketShort = row.market.slice(-8);
          const traderShort = row.trader.slice(-8);
          console.log(`   ...${marketShort} | ...${traderShort}: ${row.current_total_samples} total, ${row.current_active_samples} active`);
        }
        
        // Special focus on CDY trader
        const cdyQuery = `
          SELECT 
            market,
            COUNT(*) as total_samples,
            COUNT(*) FILTER (WHERE is_active) as active_samples,
            MAX(timestamp) as last_update
          FROM market_maker_stats 
          WHERE trader = 'CDY3cxDRUrcJp8DNhPS8X6CR3FGDjrErYv1PcgsEeNMV'
            AND timestamp > NOW() - INTERVAL '24 hours'
          GROUP BY market
        `;
        
        const cdyResult = await this.pool.query(cdyQuery);
        if (cdyResult.rows.length > 0) {
          console.log(`\n🎯 CDY TRADER SAMPLE TRACKING:`);
          for (const row of cdyResult.rows) {
            const marketShort = row.market.slice(-8);
            console.log(`   Market ...${marketShort}: ${row.total_samples} samples, last update: ${row.last_update}`);
          }
        }
        
      } catch (error) {
        console.error('Error querying sample counts:', error);
      }

      // Update summary statistics (using 24h for Prometheus)
      await this.updatePrometheusMetrics();

      console.log(
        `✅ Monitoring cycle complete. Processed ${uniqueStats.length} total market maker entries.`,
      );
    } finally {
      this.isMonitoring = false;
    }
  }

  /**
   * Save market maker stats to database
   */
  async saveStatsToDatabase(
    stats: MarketMakerStats[],
    timestamp: Date,
  ): Promise<void> {
    if (stats.length === 0) return;

    // Remove duplicates before batch insert
    const uniqueStats = stats.filter((stat, index, array) => {
      return index === array.findIndex(s => 
        s.market === stat.market && 
        s.trader === stat.trader && 
        s.timestamp.getTime() === stat.timestamp.getTime()
      );
    });
    
    console.log(`Filtered ${stats.length - uniqueStats.length} duplicate records`);
    if (stats.length - uniqueStats.length > 0) {
      console.warn(`⚠️  Detected ${stats.length - uniqueStats.length} duplicates - race condition may exist`);
    }

    try {
      console.log('Saving market maker stats to database...');

      // Batch insert market maker stats with UPSERT
      const batchSize = 50;
      for (let i = 0; i < uniqueStats.length; i += batchSize) {
        const batch = uniqueStats.slice(i, i + batchSize);

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
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`;
          })
          .join(', ');

        const query = `
          INSERT INTO market_maker_stats (
            market, trader, timestamp, is_active, total_notional_usd,
            bid_depth_10_bps, bid_depth_50_bps, bid_depth_100_bps, bid_depth_200_bps,
            ask_depth_10_bps, ask_depth_50_bps, ask_depth_100_bps, ask_depth_200_bps
          ) VALUES ${placeholders}
          ON CONFLICT (market, trader, timestamp) 
          DO UPDATE SET 
            is_active = EXCLUDED.is_active,
            total_notional_usd = EXCLUDED.total_notional_usd,
            bid_depth_10_bps = EXCLUDED.bid_depth_10_bps,
            bid_depth_50_bps = EXCLUDED.bid_depth_50_bps,
            bid_depth_100_bps = EXCLUDED.bid_depth_100_bps,
            bid_depth_200_bps = EXCLUDED.bid_depth_200_bps,
            ask_depth_10_bps = EXCLUDED.ask_depth_10_bps,
            ask_depth_50_bps = EXCLUDED.ask_depth_50_bps,
            ask_depth_100_bps = EXCLUDED.ask_depth_100_bps,
            ask_depth_200_bps = EXCLUDED.ask_depth_200_bps
        `;

        await this.pool.query(query, values);

        if (i + batchSize < uniqueStats.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      // Save market info snapshots
      const marketInfoValues = Array.from(this.marketInfo.values()).flatMap(
        (info) => [info.address, timestamp, info.volume24hUsd, info.lastPrice],
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
   * Update Prometheus metrics (still using 24h for consistency)
   */
  async updatePrometheusMetrics(): Promise<void> {
    try {
      const uptimeQuery = `
        WITH recent_stats AS (
          SELECT 
            market,
            trader,
            is_active
          FROM market_maker_stats
          WHERE timestamp > NOW() - INTERVAL '24 hours'
            AND total_notional_usd >= ${MIN_NOTIONAL_USD}
        )
        SELECT 
          market,
          trader,
          CASE 
            WHEN COUNT(*) > 0 THEN 
              (COUNT(*) FILTER (WHERE is_active)::NUMERIC / COUNT(*)) * 100
            ELSE 0 
          END as uptime_24h
        FROM recent_stats
        GROUP BY market, trader
        HAVING COUNT(*) > 0
      `;

      const uptimeResult = await this.pool.query(uptimeQuery);
      for (const row of uptimeResult.rows) {
        marketMakerUptime.set(
          { market: row.market, trader: row.trader },
          Number(row.uptime_24h),
        );
      }

      console.log('Successfully updated Prometheus metrics');
    } catch (error) {
      console.error('Error updating Prometheus metrics:', error);
    }
  }

  /**
   * Get market maker statistics for a specific time period
   */
  async getMarketMakerStats(
    options: {
      market?: string;
      trader?: string;
      hours?: number; // How many hours back to look
      startTimestamp?: number; // Unix timestamp (seconds)
      endTimestamp?: number; // Unix timestamp (seconds)
      limit?: number;
    } = {},
  ): Promise<any[]> {
    try {
      const {
        market,
        trader,
        hours = 24,
        startTimestamp,
        endTimestamp,
        limit = 100,
      } = options;

      // Build time filter - prioritize timestamps over hours
      let timeFilter = '';
      if (startTimestamp && endTimestamp) {
        timeFilter = `timestamp >= to_timestamp(${startTimestamp}) AND timestamp <= to_timestamp(${endTimestamp})`;
      } else if (startTimestamp) {
        timeFilter = `timestamp >= to_timestamp(${startTimestamp})`;
      } else if (endTimestamp) {
        timeFilter = `timestamp <= to_timestamp(${endTimestamp})`;
      } else {
        timeFilter = `timestamp > NOW() - INTERVAL '${hours} hours'`;
      }

      let query = `
        WITH time_bounds AS (
          -- Get the actual time range we're analyzing
          SELECT 
            MIN(timestamp) as start_time,
            MAX(timestamp) as end_time
          FROM market_maker_stats
          WHERE ${timeFilter}
        ),
        total_cycles_per_market AS (
          SELECT 
            market,
            COUNT(DISTINCT timestamp) as total_possible_cycles
          FROM market_maker_stats
          WHERE ${timeFilter}
          GROUP BY market
        ),
        recent_stats AS (
          SELECT 
            market,
            trader,
            timestamp,
            is_active,
            total_notional_usd,
            -- Include ALL spread levels
            bid_depth_10_bps,
            bid_depth_50_bps,
            bid_depth_100_bps,
            bid_depth_200_bps,
            ask_depth_10_bps,
            ask_depth_50_bps,
            ask_depth_100_bps,
            ask_depth_200_bps,
            -- Track first and last seen times
            MIN(timestamp) OVER (PARTITION BY market, trader) as first_seen,
            MAX(timestamp) OVER (PARTITION BY market, trader) as last_seen
          FROM market_maker_stats
          WHERE ${timeFilter}
            AND total_notional_usd >= ${MIN_NOTIONAL_USD}
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (market) {
        query += ` AND market = $${paramIndex}`;
        params.push(market);
        paramIndex++;
      }

      if (trader) {
        query += ` AND trader = $${paramIndex}`;
        params.push(trader);
        paramIndex++;
      }

      query += `
        ),
        summary_stats AS (
          SELECT 
            rs.market,
            rs.trader,
            MAX(rs.last_seen) as last_active,
            MIN(rs.first_seen) as first_seen,
            COUNT(*) as total_samples,
            COUNT(*) FILTER (WHERE rs.is_active) as active_samples,
            -- TRUE UPTIME: active samples / total possible cycles for this market
            tcpm.total_possible_cycles,
            CASE 
              WHEN tcpm.total_possible_cycles > 0 THEN 
                (COUNT(*) FILTER (WHERE rs.is_active)::NUMERIC / tcpm.total_possible_cycles) * 100
              ELSE 0 
            END as uptime_percentage,
            -- PRESENCE: how often they appeared / total possible cycles
            CASE 
              WHEN tcpm.total_possible_cycles > 0 THEN 
                (COUNT(*)::NUMERIC / tcpm.total_possible_cycles) * 100
              ELSE 0 
            END as presence_percentage,
            -- Calculate tracking period in hours
            EXTRACT(EPOCH FROM (MAX(rs.last_seen) - MIN(rs.first_seen))) / 3600 as tracking_hours,
            -- Average depths when active for ALL spread levels
            AVG(rs.bid_depth_10_bps) FILTER (WHERE rs.is_active AND rs.bid_depth_10_bps > 0) as avg_bid_depth_10_bps,
            AVG(rs.bid_depth_50_bps) FILTER (WHERE rs.is_active AND rs.bid_depth_50_bps > 0) as avg_bid_depth_50_bps,
            AVG(rs.bid_depth_100_bps) FILTER (WHERE rs.is_active AND rs.bid_depth_100_bps > 0) as avg_bid_depth_100_bps,
            AVG(rs.bid_depth_200_bps) FILTER (WHERE rs.is_active AND rs.bid_depth_200_bps > 0) as avg_bid_depth_200_bps,
            AVG(rs.ask_depth_10_bps) FILTER (WHERE rs.is_active AND rs.ask_depth_10_bps > 0) as avg_ask_depth_10_bps,
            AVG(rs.ask_depth_50_bps) FILTER (WHERE rs.is_active AND rs.ask_depth_50_bps > 0) as avg_ask_depth_50_bps,
            AVG(rs.ask_depth_100_bps) FILTER (WHERE rs.is_active AND rs.ask_depth_100_bps > 0) as avg_ask_depth_100_bps,
            AVG(rs.ask_depth_200_bps) FILTER (WHERE rs.is_active AND rs.ask_depth_200_bps > 0) as avg_ask_depth_200_bps,
            AVG(rs.total_notional_usd) FILTER (WHERE rs.is_active) as avg_notional_usd
          FROM recent_stats rs
          JOIN total_cycles_per_market tcpm ON rs.market = tcpm.market
          GROUP BY rs.market, rs.trader, tcpm.total_possible_cycles
        )
        SELECT 
          ss.*,
          -- Include all spread levels with COALESCE for null handling
          COALESCE(ss.avg_bid_depth_10_bps, 0) as avg_bid_depth_10_bps,
          COALESCE(ss.avg_bid_depth_50_bps, 0) as avg_bid_depth_50_bps,
          COALESCE(ss.avg_bid_depth_100_bps, 0) as avg_bid_depth_100_bps,
          COALESCE(ss.avg_bid_depth_200_bps, 0) as avg_bid_depth_200_bps,
          COALESCE(ss.avg_ask_depth_10_bps, 0) as avg_ask_depth_10_bps,
          COALESCE(ss.avg_ask_depth_50_bps, 0) as avg_ask_depth_50_bps,
          COALESCE(ss.avg_ask_depth_100_bps, 0) as avg_ask_depth_100_bps,
          COALESCE(ss.avg_ask_depth_200_bps, 0) as avg_ask_depth_200_bps,
          -- Legacy fields for backward compatibility
          COALESCE(ss.avg_bid_depth_100_bps, 0) as avg_bid_depth,
          COALESCE(ss.avg_ask_depth_100_bps, 0) as avg_ask_depth,
          COALESCE(ss.avg_bid_depth_100_bps, 0) + COALESCE(ss.avg_ask_depth_100_bps, 0) as total_avg_depth,
          -- Market info
          mis.volume_24h_usd,
          mis.last_price,
          -- Helpful display fields
          CASE 
            WHEN ss.tracking_hours < 1 THEN 'Less than 1 hour'
            WHEN ss.tracking_hours < 24 THEN ROUND(ss.tracking_hours, 1) || ' hours'
            ELSE ROUND(ss.tracking_hours / 24, 1) || ' days'
          END as tracking_period,
          ROUND(ss.uptime_percentage, 1) as uptime_percent,
          ROUND(ss.presence_percentage, 1) as presence_percent,
          -- Add timestamps for reference
          EXTRACT(EPOCH FROM ss.first_seen) as first_seen_timestamp,
          EXTRACT(EPOCH FROM ss.last_active) as last_active_timestamp
        FROM summary_stats ss
        LEFT JOIN LATERAL (
          SELECT volume_24h_usd, last_price
          FROM market_info_snapshots mis_inner
          WHERE mis_inner.market = ss.market
          ORDER BY timestamp DESC
          LIMIT 1
        ) mis ON true
        ORDER BY 
          ss.uptime_percentage DESC,
          (COALESCE(ss.avg_bid_depth_100_bps, 0) + COALESCE(ss.avg_ask_depth_100_bps, 0)) DESC
        LIMIT $${paramIndex}
      `;

      params.push(limit);

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting market maker stats:', error);
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
          COUNT(DISTINCT mms.trader) as unique_makers_24h,
          -- Get current stats (last hour)
          COUNT(DISTINCT mms_current.trader) as unique_makers_current
        FROM market_info_snapshots mis
        LEFT JOIN market_maker_stats mms ON mis.market = mms.market 
          AND mms.timestamp > NOW() - INTERVAL '24 hours'
          AND mms.total_notional_usd >= ${MIN_NOTIONAL_USD}
        LEFT JOIN market_maker_stats mms_current ON mis.market = mms_current.market 
          AND mms_current.timestamp > NOW() - INTERVAL '1 hour'
          AND mms_current.total_notional_usd >= ${MIN_NOTIONAL_USD}
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

  // Market maker statistics with flexible time periods
  app.get('/market-makers', async (req, res) => {
    try {
      const market = req.query.market as string;
      const trader = req.query.trader as string;
      const hours = req.query.hours ? parseInt(req.query.hours as string) : 24;
      const startTimestamp = req.query.start
        ? parseInt(req.query.start as string)
        : undefined;
      const endTimestamp = req.query.end
        ? parseInt(req.query.end as string)
        : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      const stats = await monitor.getMarketMakerStats({
        market,
        trader,
        hours,
        startTimestamp,
        endTimestamp,
        limit,
      });

      res.json({
        data: stats,
        meta: {
          timeframe_hours: hours,
          start_timestamp: startTimestamp,
          end_timestamp: endTimestamp,
          total_results: stats.length,
          query_timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Error getting market maker stats:', error);
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

  // Raw market maker data for custom queries
  app.get('/market-makers/raw', async (req, res) => {
    try {
      const market = req.query.market as string;
      const trader = req.query.trader as string;
      const hours = req.query.hours ? parseInt(req.query.hours as string) : 24;
      const startTimestamp = req.query.start
        ? parseInt(req.query.start as string)
        : undefined;
      const endTimestamp = req.query.end
        ? parseInt(req.query.end as string)
        : undefined;
      const limit = req.query.limit
        ? parseInt(req.query.limit as string)
        : 1000;

      // Build time filter - prioritize timestamps over hours
      let timeFilter = '';
      if (startTimestamp && endTimestamp) {
        timeFilter = `timestamp >= to_timestamp(${startTimestamp}) AND timestamp <= to_timestamp(${endTimestamp})`;
      } else if (startTimestamp) {
        timeFilter = `timestamp >= to_timestamp(${startTimestamp})`;
      } else if (endTimestamp) {
        timeFilter = `timestamp <= to_timestamp(${endTimestamp})`;
      } else {
        timeFilter = `timestamp > NOW() - INTERVAL '${hours} hours'`;
      }

      let query = `
        SELECT *,
          EXTRACT(EPOCH FROM timestamp) as timestamp_unix
        FROM market_maker_stats
        WHERE ${timeFilter}
          AND total_notional_usd >= ${MIN_NOTIONAL_USD}
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (market) {
        query += ` AND market = $${paramIndex}`;
        params.push(market);
        paramIndex++;
      }

      if (trader) {
        query += ` AND trader = $${paramIndex}`;
        params.push(trader);
        paramIndex++;
      }

      query += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await monitor.pool.query(query, params);

      res.json({
        data: result.rows,
        meta: {
          timeframe_hours: hours,
          start_timestamp: startTimestamp,
          end_timestamp: endTimestamp,
          total_results: result.rows.length,
          query_timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Error getting raw market maker data:', error);
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
