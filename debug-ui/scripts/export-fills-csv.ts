/**
 * Export fills to CSV for a given slot range
 *
 * Usage:
 *   npm run export-fills -- --from-slot 378922129 --to-slot 379922129
 *   npm run export-fills -- --from-slot 378922129 --to-slot 379922129 --output fills.csv
 *   npm run export-fills -- --to-slot 379922129 --count 1000000
 *
 * The --count option will go back N slots from the to-slot
 */

import { Pool } from 'pg';
import { FillLogResult, Market } from '@cks-systems/manifest-sdk';
import { createWriteStream } from 'fs';
import { Connection, PublicKey } from '@solana/web3.js';
import stringify = require('csv-stringify');

const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URL = process.env.RPC_URL;
const BATCH_SIZE = 1000; // Fetch 1000 fills at a time to avoid overloading DB
const RPC_DELAY_MS = 50; // Delay between RPC calls to avoid rate limiting

interface FillRow {
  slot: number;
  timestamp: number;
  market: string;
  baseMint: string;
  quoteMint: string;
  signature: string;
  taker: string;
  maker: string;
  baseAtoms: string;
  quoteAtoms: string;
  priceAtoms: number;
  takerIsBuy: boolean;
  isMakerGlobal: boolean;
  takerSequenceNumber: string;
  makerSequenceNumber: string;
  originalSigner?: string;
}

interface MarketInfo {
  baseMint: string;
  quoteMint: string;
}

/**
 * Sleep for a specified duration
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch block timestamp with retry and backoff
 */
async function getBlockTimestamp(
  connection: Connection,
  slot: number,
  timestampCache: Map<number, number>,
): Promise<number> {
  // Check cache first
  if (timestampCache.has(slot)) {
    return timestampCache.get(slot)!;
  }

  let retries = 0;
  const maxRetries = 3;

  while (retries < maxRetries) {
    try {
      await sleep(RPC_DELAY_MS);
      const blockTime = await connection.getBlockTime(slot);

      if (blockTime !== null) {
        timestampCache.set(slot, blockTime);
        return blockTime;
      }

      // Block time is null, retry
      retries++;
      await sleep(1000 * retries); // Exponential backoff
    } catch (error) {
      retries++;
      console.warn(
        `Failed to get block time for slot ${slot} (attempt ${retries}/${maxRetries}):`,
        error,
      );
      if (retries < maxRetries) {
        await sleep(1000 * retries); // Exponential backoff
      }
    }
  }

  // If we couldn't get the timestamp, return 0
  console.warn(`Could not get timestamp for slot ${slot}, using 0`);
  timestampCache.set(slot, 0);
  return 0;
}

/**
 * Fetch market info with caching
 */
async function getMarketInfo(
  connection: Connection,
  marketAddress: string,
  marketCache: Map<string, MarketInfo>,
): Promise<MarketInfo> {
  // Check cache first
  if (marketCache.has(marketAddress)) {
    return marketCache.get(marketAddress)!;
  }

  try {
    await sleep(RPC_DELAY_MS);
    const market = await Market.loadFromAddress({
      connection,
      address: new PublicKey(marketAddress),
    });

    const marketInfo: MarketInfo = {
      baseMint: market.baseMint().toBase58(),
      quoteMint: market.quoteMint().toBase58(),
    };

    marketCache.set(marketAddress, marketInfo);
    return marketInfo;
  } catch (error) {
    console.error(`Failed to load market ${marketAddress}:`, error);
    // Return empty strings on error
    const fallback: MarketInfo = {
      baseMint: '',
      quoteMint: '',
    };
    marketCache.set(marketAddress, fallback);
    return fallback;
  }
}

/**
 * Fetch fills from database in batches
 */
async function fetchFillsInBatches(
  pool: Pool,
  fromSlot: number,
  toSlot: number,
  onBatch: (fills: FillLogResult[]) => Promise<void>,
): Promise<void> {
  let offset = 0;
  let hasMore = true;
  let totalFetched = 0;

  console.log(`\nFetching fills from slot ${fromSlot} to ${toSlot}...`);

  while (hasMore) {
    const query = `
      SELECT fill_data
      FROM fills_complete
      WHERE
        (fill_data->>'slot')::bigint >= $1
        AND (fill_data->>'slot')::bigint <= $2
      ORDER BY (fill_data->>'slot')::bigint ASC
      LIMIT $3 OFFSET $4
    `;

    const result = await pool.query(query, [
      fromSlot,
      toSlot,
      BATCH_SIZE,
      offset,
    ]);

    if (result.rows.length === 0) {
      hasMore = false;
      break;
    }

    const fills: FillLogResult[] = result.rows.map((row) => row.fill_data);
    totalFetched += fills.length;

    console.log(
      `Fetched batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${fills.length} fills (total: ${totalFetched})`,
    );

    await onBatch(fills);

    if (result.rows.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      offset += BATCH_SIZE;
      // Small delay to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log(`Total fills fetched: ${totalFetched}`);
}

/**
 * Convert FillLogResult to CSV row
 */
function fillToRow(
  fill: FillLogResult,
  timestamp: number,
  baseMint: string,
  quoteMint: string,
): FillRow {
  return {
    slot: fill.slot,
    timestamp,
    market: fill.market,
    baseMint,
    quoteMint,
    signature: fill.signature,
    taker: fill.taker,
    maker: fill.maker,
    baseAtoms: fill.baseAtoms.toString(),
    quoteAtoms: fill.quoteAtoms.toString(),
    priceAtoms: fill.priceAtoms,
    takerIsBuy: fill.takerIsBuy,
    isMakerGlobal: fill.isMakerGlobal,
    takerSequenceNumber: fill.takerSequenceNumber.toString(),
    makerSequenceNumber: fill.makerSequenceNumber.toString(),
    originalSigner: fill.originalSigner,
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): {
  fromSlot: number;
  toSlot: number;
  outputFile: string;
} {
  let fromSlot: number | undefined;
  let toSlot: number | undefined;
  let count: number | undefined;
  let outputFile = 'fills.csv';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-slot' && args[i + 1]) {
      fromSlot = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--to-slot' && args[i + 1]) {
      toSlot = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    }
  }

  if (!toSlot) {
    throw new Error('--to-slot is required');
  }

  if (count && !fromSlot) {
    fromSlot = toSlot - count;
  }

  if (!fromSlot) {
    throw new Error(
      'Either --from-slot or --count must be provided with --to-slot',
    );
  }

  return { fromSlot, toSlot, outputFile };
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const { fromSlot, toSlot, outputFile } = parseArgs(args);

  console.log(`Exporting fills from slot ${fromSlot} to ${toSlot}`);
  console.log(`Output file: ${outputFile}`);
  console.log(`Slot range: ${toSlot - fromSlot} slots`);

  // Validate environment variables
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  if (!RPC_URL) {
    throw new Error('RPC_URL environment variable is required');
  }

  // Connect to RPC
  console.log('\nConnecting to RPC...');
  const connection = new Connection(RPC_URL, 'confirmed');

  // Connect to database
  console.log('Connecting to database...');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Create caches
    const timestampCache = new Map<number, number>();
    const marketCache = new Map<string, MarketInfo>();

    // First pass: Fetch all fills from database
    console.log('\nFetching fills from database...');
    const allFills: FillLogResult[] = [];
    await fetchFillsInBatches(pool, fromSlot, toSlot, async (fills) => {
      allFills.push(...fills);
    });

    console.log(`Total fills fetched: ${allFills.length}`);

    // Collect unique slots and markets
    const uniqueSlots = new Set<number>();
    const uniqueMarkets = new Set<string>();

    for (const fill of allFills) {
      uniqueSlots.add(fill.slot);
      uniqueMarkets.add(fill.market);
    }

    console.log(
      `\nEnriching data: ${uniqueSlots.size} unique slots, ${uniqueMarkets.size} unique markets`,
    );

    // Fetch timestamps for all unique slots
    console.log('\nFetching block timestamps...');
    const slotsArray = Array.from(uniqueSlots);
    let fetchedTimestamps = 0;
    for (const slot of slotsArray) {
      await getBlockTimestamp(connection, slot, timestampCache);
      fetchedTimestamps++;
      if (fetchedTimestamps % 100 === 0) {
        console.log(
          `  Fetched ${fetchedTimestamps}/${slotsArray.length} timestamps`,
        );
      }
    }
    console.log(`  Fetched all ${fetchedTimestamps} timestamps`);

    // Fetch market info for all unique markets
    console.log('\nFetching market information...');
    const marketsArray = Array.from(uniqueMarkets);
    let fetchedMarkets = 0;
    for (const market of marketsArray) {
      await getMarketInfo(connection, market, marketCache);
      fetchedMarkets++;
      console.log(
        `  Fetched market ${fetchedMarkets}/${marketsArray.length}: ${market}`,
      );
    }

    // Second pass: Write to CSV with enriched data
    console.log('\nWriting to CSV...');
    const writeStream = createWriteStream(outputFile);
    const csvStringifier = stringify({
      header: true,
      columns: [
        'slot',
        'timestamp',
        'market',
        'baseMint',
        'quoteMint',
        'signature',
        'taker',
        'maker',
        'baseAtoms',
        'quoteAtoms',
        'priceAtoms',
        'takerIsBuy',
        'isMakerGlobal',
        'takerSequenceNumber',
        'makerSequenceNumber',
        'originalSigner',
      ],
    });

    csvStringifier.pipe(writeStream);

    let fillsWritten = 0;
    for (const fill of allFills) {
      const timestamp = timestampCache.get(fill.slot) || 0;
      const marketInfo = marketCache.get(fill.market) || {
        baseMint: '',
        quoteMint: '',
      };

      const row = fillToRow(
        fill,
        timestamp,
        marketInfo.baseMint,
        marketInfo.quoteMint,
      );
      csvStringifier.write(row);
      fillsWritten++;

      if (fillsWritten % 1000 === 0) {
        console.log(`  Written ${fillsWritten}/${allFills.length} fills`);
      }
    }

    console.log(`\nTotal fills written to CSV: ${fillsWritten}`);

    // Close CSV writer
    csvStringifier.end();

    // Wait for file to be written
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log(`Successfully exported fills to ${outputFile}`);
  } catch (error) {
    console.error('Error exporting fills:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
