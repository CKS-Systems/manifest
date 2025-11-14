/**
 * Export fills to CSV for a given 24-hour UTC period
 *
 * Usage:
 *   npm run export-fills -- 2025-01-13
 *   npm run export-fills -- 2025-01-13 --output fills-2025-01-13.csv
 *
 * This will export all fills for the specified day (midnight to midnight UTC)
 * If no date is provided, it defaults to yesterday
 */

import { Pool } from 'pg';
import { FillLogResult } from '@cks-systems/manifest-sdk';
import { createWriteStream } from 'fs';
import stringify = require('csv-stringify');

const DATABASE_URL = process.env.DATABASE_URL;
const BATCH_SIZE = 1000; // Fetch 1000 fills at a time to avoid overloading DB

interface FillRow {
  slot: number;
  market: string;
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

/**
 * Parse date string in YYYY-MM-DD format and return start/end timestamps in UTC
 */
function parseDateRange(dateStr: string): { start: Date; end: Date } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Get yesterday's date in YYYY-MM-DD format (UTC)
 */
function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Convert timestamp to slot (approximate)
 * Solana slots are approximately 400ms apart
 * Genesis timestamp: 2020-03-16T00:00:00.000Z (slot 0)
 */
function timestampToSlot(timestamp: Date): number {
  const GENESIS_TIMESTAMP = new Date('2020-03-16T00:00:00.000Z').getTime();
  const SLOT_DURATION_MS = 400; // Approximate
  const diffMs = timestamp.getTime() - GENESIS_TIMESTAMP;
  return Math.floor(diffMs / SLOT_DURATION_MS);
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

  console.log(`Fetching fills from slot ${fromSlot} to ${toSlot}...`);

  while (hasMore) {
    const query = `
      SELECT fill_data
      FROM fills_complete
      WHERE
        (fill_data->>'slot')::bigint >= $1
        AND (fill_data->>'slot')::bigint <= $2
      ORDER BY (fill_data->>'slot')::bigint ASC, (fill_data->>'timestamp')::bigint ASC
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
function fillToRow(fill: FillLogResult): FillRow {
  return {
    slot: fill.slot,
    market: fill.market,
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
 * Main function
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const dateArg = args.find((arg) => !arg.startsWith('--'));
  const outputArg = args.find((arg, idx) => args[idx - 1] === '--output');

  const dateStr = dateArg || getYesterdayDate();
  const outputFile = outputArg || `fills-${dateStr}.csv`;

  console.log(`Exporting fills for ${dateStr} to ${outputFile}`);

  // Parse date range
  const { start, end } = parseDateRange(dateStr);
  console.log(`Date range: ${start.toISOString()} to ${end.toISOString()}`);

  // Convert to approximate slot range
  const fromSlot = timestampToSlot(start);
  const toSlot = timestampToSlot(end);
  console.log(`Approximate slot range: ${fromSlot} to ${toSlot}`);

  // Connect to database
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Create CSV writer
    const writeStream = createWriteStream(outputFile);
    const csvStringifier = stringify({
      header: true,
      columns: [
        'slot',
        'market',
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

    // Fetch and write fills in batches
    await fetchFillsInBatches(pool, fromSlot, toSlot, async (fills) => {
      for (const fill of fills) {
        const row = fillToRow(fill);
        csvStringifier.write(row);
      }
    });

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
