import 'dotenv/config';

import { FillFeed } from '@cks-systems/manifest-sdk';
import { Connection } from '@solana/web3.js';

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

const run = async () => {
  console.log('starting fill feed...');

  const conn = new Connection(RPC_URL!, 'confirmed');
  const feed = new FillFeed(conn);
  await feed.parseLogs(false);
};

run().catch((e) => {
  console.error(e);
  throw e;
});
