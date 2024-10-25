import 'dotenv/config';

import { FillFeed } from '@cks-systems/manifest-sdk/fillFeed';
import { Connection } from '@solana/web3.js';
import { sleep } from '@/lib/util';

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

const rpcUrl = RPC_URL as string;

const monitorFeed = async (feed: FillFeed) => {
  // 5 minutes
  const deadThreshold = 300_000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(60_000);
    const msSinceUpdate = feed.msSinceLastUpdate();
    if (msSinceUpdate > deadThreshold) {
      throw new Error(
        `fillFeed has had no updates since ${deadThreshold / 1_000} seconds ago.`,
      );
    }
  }
};

const run = async () => {
  const timeoutMs = 5_000;

  console.log('starting feed...');
  let feed: FillFeed | null = null;
  while (true) {
    try {
      console.log('setting up connection...');
      const conn = new Connection(rpcUrl, 'confirmed');
      console.log('setting up feed...');
      feed = new FillFeed(conn);
      console.log('parsing logs...');
      await Promise.all([monitorFeed(feed), feed.parseLogs()]);
    } catch (e: unknown) {
      console.error('start:feed: error: ', e);
      if (feed) {
        console.log('shutting down feed before restarting...');
        await feed.stopParseLogs();
        console.log('feed has shut down successfully');
      }
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
