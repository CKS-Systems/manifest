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
    console.log(`Fetching last 10 checkpoints for market: ${TARGET_MARKET}\n`);

    // Get the last 10 checkpoints
    const checkpointResult = await pool.query(
      'SELECT id, last_fill_slot, created_at FROM state_checkpoints ORDER BY created_at DESC LIMIT 10'
    );

    if (checkpointResult.rowCount === 0) {
      console.log('No checkpoints found in database');
      return;
    }

    console.log(`Found ${checkpointResult.rowCount} checkpoints\n`);

    // Process each checkpoint
    for (const checkpoint of checkpointResult.rows) {
      console.log('\n========================================');
      console.log('Checkpoint ID:', checkpoint.id);
      console.log('Last Fill Slot:', checkpoint.last_fill_slot);
      console.log('Created At:', checkpoint.created_at);
      console.log('========================================');

      // Get market checkpoint data for this specific market
      const marketCheckpointsResult = await pool.query(
        `SELECT
          market,
          base_volume_checkpoints::text AS base_volume_checkpoints_text,
          quote_volume_checkpoints::text AS quote_volume_checkpoints_text,
          last_price
        FROM market_checkpoints
        WHERE checkpoint_id = $1 AND market = $2`,
        [checkpoint.id, TARGET_MARKET]
      );

      if (marketCheckpointsResult.rowCount === 0) {
        console.log(`No data found for market ${TARGET_MARKET} in this checkpoint\n`);
        continue;
      }

      const row = marketCheckpointsResult.rows[0];
      const baseCheckpoints = JSON.parse(row.base_volume_checkpoints_text);
      const quoteCheckpoints = JSON.parse(row.quote_volume_checkpoints_text);

      // Calculate total volume from checkpoints
      const totalBaseVolume = baseCheckpoints.reduce((sum: number, vol: number) => sum + vol, 0);
      const totalQuoteVolume = quoteCheckpoints.reduce((sum: number, vol: number) => sum + vol, 0);

      console.log('Market:', row.market);
      console.log('Last Price:', row.last_price);
      console.log('Number of Checkpoints:', baseCheckpoints.length);
      console.log('Total Base Volume (atoms):', totalBaseVolume);
      console.log('Total Quote Volume (atoms):', totalQuoteVolume);
      console.log('Base Volume Checkpoints:', baseCheckpoints);
      console.log('Quote Volume Checkpoints:', quoteCheckpoints);

      // Also show volume since last checkpoint
      const volumesResult = await pool.query(
        `SELECT
          market,
          base_volume_since_last_checkpoint,
          quote_volume_since_last_checkpoint
        FROM market_volumes
        WHERE checkpoint_id = $1 AND market = $2`,
        [checkpoint.id, TARGET_MARKET]
      );

      if (volumesResult.rowCount > 0) {
        const volRow = volumesResult.rows[0];
        console.log('\nVolume Since Last Checkpoint:');
        console.log('  Base Volume:', volRow.base_volume_since_last_checkpoint);
        console.log('  Quote Volume:', volRow.quote_volume_since_last_checkpoint);
      }

      console.log('');
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
