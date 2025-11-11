import 'dotenv/config';
import { Pool } from 'pg';

async function readMarketCheckpoints() {
  const { DATABASE_URL } = process.env;

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

    // Get the most recent checkpoint ID
    const checkpointResult = await pool.query(
      'SELECT id, last_fill_slot, created_at FROM state_checkpoints ORDER BY created_at DESC LIMIT 1'
    );

    if (checkpointResult.rowCount === 0) {
      console.log('No checkpoints found in database');
      return;
    }

    const checkpoint = checkpointResult.rows[0];
    console.log('\n========================================');
    console.log('Most Recent Checkpoint:');
    console.log('========================================');
    console.log('ID:', checkpoint.id);
    console.log('Last Fill Slot:', checkpoint.last_fill_slot);
    console.log('Created At:', checkpoint.created_at);
    console.log('========================================\n');

    // Get all market checkpoints for this checkpoint
    const marketCheckpointsResult = await pool.query(
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

    console.log(`Found ${marketCheckpointsResult.rowCount} market checkpoints\n`);

    for (const row of marketCheckpointsResult.rows) {
      const baseCheckpoints = JSON.parse(row.base_volume_checkpoints_text);
      const quoteCheckpoints = JSON.parse(row.quote_volume_checkpoints_text);

      // Calculate total volume from checkpoints
      const totalBaseVolume = baseCheckpoints.reduce((sum: number, vol: number) => sum + vol, 0);
      const totalQuoteVolume = quoteCheckpoints.reduce((sum: number, vol: number) => sum + vol, 0);

      console.log('----------------------------------------');
      console.log('Market:', row.market);
      console.log('Last Price:', row.last_price);
      console.log('Number of Checkpoints:', baseCheckpoints.length);
      console.log('Total Base Volume (atoms):', totalBaseVolume);
      console.log('Total Quote Volume (atoms):', totalQuoteVolume);
      console.log('Base Volume Checkpoints:', baseCheckpoints);
      console.log('Quote Volume Checkpoints:', quoteCheckpoints);
      console.log('----------------------------------------\n');
    }

    // Also show market volumes (volume since last checkpoint)
    const volumesResult = await pool.query(
      `SELECT
        market,
        base_volume_since_last_checkpoint,
        quote_volume_since_last_checkpoint
      FROM market_volumes
      WHERE checkpoint_id = $1
      ORDER BY market`,
      [checkpoint.id]
    );

    console.log('\n========================================');
    console.log('Volume Since Last Checkpoint:');
    console.log('========================================\n');

    for (const row of volumesResult.rows) {
      console.log('Market:', row.market);
      console.log('  Base Volume:', row.base_volume_since_last_checkpoint);
      console.log('  Quote Volume:', row.quote_volume_since_last_checkpoint);
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
