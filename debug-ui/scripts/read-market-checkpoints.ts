import 'dotenv/config';
import { Pool } from 'pg';

async function readMarketCheckpoints() {
  const { DATABASE_URL } = process.env;
  const TARGET_MARKET = '8sjV1AqBFvFuADBCQHhotaRq5DFFYSjjg1jMyVWMqXvZ';

  if (!DATABASE_URL) {
    console.error('DATABASE_URL not found in environment');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');

    // First, get summary of all markets and their checkpoint counts
    console.log('\n========================================');
    console.log('Market Checkpoint Summary:');
    console.log('========================================');

    const marketSummaryResult = await pool.query(
      `SELECT market, COUNT(*) as checkpoint_count
       FROM market_checkpoints
       GROUP BY market
       ORDER BY checkpoint_count DESC, market`
    );

    console.log(`\nFound ${marketSummaryResult.rowCount} markets in database:\n`);

    for (const row of marketSummaryResult.rows) {
      const isTargetMarket = row.market === TARGET_MARKET ? ' ← TARGET MARKET' : '';
      console.log(`${row.market}: ${row.checkpoint_count} checkpoints${isTargetMarket}`);
    }

    console.log('\n========================================');
    console.log(`\nFetching last 10 checkpoints for market: ${TARGET_MARKET}\n`);

    // Get the last 10 checkpoints
    const checkpointResult = await pool.query(
      'SELECT id, last_fill_slot, created_at FROM state_checkpoints ORDER BY created_at DESC LIMIT 10'
    );

    if (checkpointResult.rowCount === 0) {
      console.log('No checkpoints found in database');
      return;
    }

    console.log(`Found ${checkpointResult.rowCount} total checkpoints in database\n`);

    // Process each checkpoint
    for (const checkpoint of checkpointResult.rows) {
      console.log('\n========================================');
      console.log('Checkpoint ID:', checkpoint.id);
      console.log('Last Fill Slot:', checkpoint.last_fill_slot);
      console.log('Created At:', checkpoint.created_at);
      console.log('========================================');

      // Get ALL market checkpoint data for this checkpoint
      const allMarketsResult = await pool.query(
        `SELECT
          market,
          base_volume_checkpoints::text AS base_volume_checkpoints_text,
          quote_volume_checkpoints::text AS quote_volume_checkpoints_text,
          last_price
        FROM market_checkpoints
        WHERE checkpoint_id = $1
        ORDER BY market`,
        [checkpoint.id]
      );

      console.log(`\nMarkets in this checkpoint: ${allMarketsResult.rowCount}\n`);

      // Show all markets
      for (const row of allMarketsResult.rows) {
        const baseCheckpoints = JSON.parse(row.base_volume_checkpoints_text);
        const quoteCheckpoints = JSON.parse(row.quote_volume_checkpoints_text);

        // Calculate total volume from checkpoints
        const totalBaseVolume = baseCheckpoints.reduce((sum: number, vol: number) => sum + vol, 0);
        const totalQuoteVolume = quoteCheckpoints.reduce((sum: number, vol: number) => sum + vol, 0);

        const isTargetMarket = row.market === TARGET_MARKET ? ' ← TARGET MARKET' : '';

        console.log(`--- Market: ${row.market}${isTargetMarket} ---`);
        console.log('Last Price:', row.last_price);
        console.log('Number of Checkpoints:', baseCheckpoints.length);
        console.log('Total Base Volume (atoms):', totalBaseVolume);
        console.log('Total Quote Volume (atoms):', totalQuoteVolume);
        console.log('Base Volume Checkpoints:', baseCheckpoints);
        console.log('Quote Volume Checkpoints:', quoteCheckpoints);

        // Get fill statistics for this market and checkpoint
        const fillStatsResult = await pool.query(
          `SELECT
            COUNT(*) as fill_count,
            MIN(slot) as first_slot,
            MAX(slot) as last_slot,
            MIN(timestamp) as first_timestamp,
            MAX(timestamp) as last_timestamp
          FROM fills_complete
          WHERE market = $1 AND slot <= $2`,
          [row.market, checkpoint.last_fill_slot]
        );

        if (fillStatsResult.rowCount > 0 && fillStatsResult.rows[0].fill_count > 0) {
          const stats = fillStatsResult.rows[0];
          console.log('Fill Activity Up To This Checkpoint:');
          console.log('  Total Fills:', stats.fill_count);
          console.log('  Slot Range:', `${stats.first_slot} → ${stats.last_slot}`);
          console.log('  Time Range:', `${stats.first_timestamp} → ${stats.last_timestamp}`);
        } else {
          console.log('Fill Activity: No fills found for this market');
        }

        // Also show volume since last checkpoint
        const volumesResult = await pool.query(
          `SELECT
            base_volume_since_last_checkpoint,
            quote_volume_since_last_checkpoint
          FROM market_volumes
          WHERE checkpoint_id = $1 AND market = $2`,
          [checkpoint.id, row.market]
        );

        if (volumesResult.rowCount > 0) {
          const volRow = volumesResult.rows[0];
          console.log('Volume Since Last Checkpoint:');
          console.log('  Base Volume:', volRow.base_volume_since_last_checkpoint);
          console.log('  Quote Volume:', volRow.quote_volume_since_last_checkpoint);
        }

        console.log('');
      }
    }

  } catch (error) {
    console.error('Error reading market checkpoints:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('Database connection closed');
  }
}

readMarketCheckpoints().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
