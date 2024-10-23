import 'dotenv/config';

import { FillFeed } from '@cks-systems/manifest-sdk/fillFeed';
import { Connection } from '@solana/web3.js';
import { sleep } from '@/lib/util';

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

const run = async () => {
  const timeoutMs = 5_000;

  while (true) {
    try {
      const conn = new Connection(RPC_URL!, 'confirmed');
      const feed = new FillFeed(conn);
      await feed.parseLogs(false);
    } catch (e: unknown) {
      console.error('start:feed: error: ', e);
    } finally {
      console.warn(`sleeping ${timeoutMs / 1000} before restarting`);
      sleep(timeoutMs);
    }
  }
};

run().catch((e) => {
  console.error('fatal error');
  // we do indeed want to throw here
  throw e;
});
