import 'dotenv/config';

import { FillFeedBlockSub } from '@cks-systems/manifest-sdk/fillFeedBlockSub';
import { Connection } from '@solana/web3.js';
import { sleep } from '@/lib/util';
import * as promClient from 'prom-client';
import express from 'express';
import promBundle from 'express-prom-bundle';

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

const rpcUrl = RPC_URL as string;

const monitorFeed = async (feed: FillFeedBlockSub) => {
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
  // Prometheus monitoring for this feed on the default prometheus port.
  promClient.collectDefaultMetrics({
    labels: {
      app: 'fillFeed',
    },
  });

  const register = new promClient.Registry();
  register.setDefaultLabels({
    app: 'fillFeed',
  });
  const metricsApp = express();
  metricsApp.listen(9090);

  const promMetrics = promBundle({
    includeMethod: true,
    metricsApp,
    autoregister: false,
  });
  metricsApp.use(promMetrics);

  const timeoutMs = 5_000;

  console.log('starting feed...');
  let feed: FillFeedBlockSub | null = null;
  while (true) {
    try {
      console.log('setting up connection...');
      const conn = new Connection(rpcUrl, 'confirmed');
      console.log('setting up feed...');
      feed = new FillFeedBlockSub(conn);
      await Promise.all([monitorFeed(feed), feed.start()]);
    } catch (e: unknown) {
      console.error('start:feed: error: ', e);
      if (feed) {
        console.log('shutting down feed before restarting...');
        await feed.stop();
        console.log('feed has shut down successfully');
      }
    } finally {
      console.warn(`sleeping ${timeoutMs / 1000} before restarting`);
      await sleep(timeoutMs);
    }
  }
};

run().catch((e) => {
  console.error('fatal error');
  // we do indeed want to throw here
  throw e;
});
