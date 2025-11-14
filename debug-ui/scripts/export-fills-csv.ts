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

  // Connect to database
  console.log('\nConnecting to database...');
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

    // Track statistics
    let fillsWritten = 0;

    // Fetch and write fills in batches
    await fetchFillsInBatches(pool, fromSlot, toSlot, async (fills) => {
      for (const fill of fills) {
        const row = fillToRow(fill);
        csvStringifier.write(row);
        fillsWritten++;
      }
    });

    console.log(`\nFills written to CSV: ${fillsWritten}`);

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
