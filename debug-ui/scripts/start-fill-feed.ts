import { FillFeed } from '@cks-systems/manifest-sdk';
import { Connection } from '@solana/web3.js';

const rpcUrl = 'https://api.devnet.solana.com';

const run = async () => {
  const conn = new Connection(rpcUrl);
  const feed = new FillFeed(conn);
  await feed.parseLogs(false);
};

run().catch(console.error);
