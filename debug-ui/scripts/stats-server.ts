import WebSocket from 'ws';
import { sleep } from '@/lib/util';
import * as promClient from 'prom-client';
import express, { RequestHandler } from 'express';
import promBundle from 'express-prom-bundle';
import {
  AccountInfo,
  Connection,
  GetProgramAccountsResponse,
  PublicKey,
} from '@solana/web3.js';
import {
  FillLogResult,
  ManifestClient,
  Market,
  RestingOrder,
} from '@cks-systems/manifest-sdk';

// Stores checkpoints every 5 minutes
const CHECKPOINT_DURATION_SEC: number = 5 * 60;
const ONE_DAY_SEC: number = 24 * 60 * 60;
const PORT: number = 3000;
const DEPTHS_BPS: number[] = [50, 100, 200];

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

const fills: promClient.Counter<'market'> = new promClient.Counter({
  name: 'fills',
  help: 'Number of fills',
  labelNames: ['market'] as const,
});

const reconnects: promClient.Counter<string> = new promClient.Counter({
  name: 'reconnects',
  help: 'Number of reconnects to websocket',
});

const volume: promClient.Gauge<'market' | 'mint' | 'side'> =
  new promClient.Gauge({
    name: 'volume',
    help: 'Volume in last 24 hours in tokens',
    labelNames: ['market', 'mint', 'side'] as const,
  });

const lastPrice: promClient.Gauge<'market'> = new promClient.Gauge({
  name: 'last_price',
  help: 'Last traded price',
  labelNames: ['market'] as const,
});

const depth: promClient.Gauge<'depth_bps' | 'market' | 'trader'> =
  new promClient.Gauge({
    name: 'depth',
    help: 'Number of tokens in orders at a given depth by trader',
    labelNames: ['depth_bps', 'market', 'trader'] as const,
  });

/**
 * Server for serving stats according to this spec:
 * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0
 */
export class ManifestStatsServer {
  private connection: Connection;
  private ws: WebSocket;
  // Base and quote volume
  private baseVolumeAtomsSinceLastCheckpoint: Map<string, number> = new Map();
  private quoteVolumeAtomsSinceLastCheckpoint: Map<string, number> = new Map();

  // Hourly checkpoints
  private baseVolumeAtomsCheckpoints: Map<string, number[]> = new Map();
  private quoteVolumeAtomsCheckpoints: Map<string, number[]> = new Map();

  // Last price by market
  private lastPriceByMarket: Map<string, number> = new Map();

  // Market objects used for mints and decimals.
  private markets: Map<string, Market> = new Map();

  constructor() {
    this.connection = new Connection(RPC_URL!);
    this.ws = new WebSocket('wss://mfx-feed-mainnet.fly.dev');
    this.resetWebsocket();
  }

  private resetWebsocket() {
    // Allow old one to timeout.
    this.ws = new WebSocket('wss://mfx-feed-mainnet.fly.dev');

    this.ws.on('open', () => {});

    this.ws.on('close', () => {
      console.log('Disconnected. Reconnecting');
      this.ws = new WebSocket('wss://mfx-feed-mainnet.fly.dev');
      reconnects.inc();
    });
    this.ws.on('error', () => {
      console.log('Error. Reconnecting');
      this.ws = new WebSocket('wss://mfx-feed-mainnet.fly.dev');
      reconnects.inc();
    });

    this.ws.on('message', async (message) => {
      const fill: FillLogResult = JSON.parse(message.toString());
      const { market, baseAtoms, quoteAtoms, price } = fill;
      fills.inc({ market });

      if (this.markets.get(market) == undefined) {
        this.baseVolumeAtomsSinceLastCheckpoint.set(market, 0);
        this.quoteVolumeAtomsSinceLastCheckpoint.set(market, 0);
        this.baseVolumeAtomsCheckpoints.set(
          market,
          new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
        );
        this.quoteVolumeAtomsCheckpoints.set(
          market,
          new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
        );
        const marketPk: PublicKey = new PublicKey(market);
        this.markets.set(
          market,
          await Market.loadFromAddress({
            connection: this.connection,
            address: marketPk,
          }),
        );
      }
      lastPrice.set(
        { market },
        price *
          10 **
            (this.markets.get(market)!.baseDecimals() -
              this.markets.get(market)!.quoteDecimals()),
      );

      this.lastPriceByMarket.set(market, price);
      this.baseVolumeAtomsSinceLastCheckpoint.set(
        market,
        this.baseVolumeAtomsSinceLastCheckpoint.get(market)! +
          Number(baseAtoms),
      );
      this.quoteVolumeAtomsSinceLastCheckpoint.set(
        market,
        this.quoteVolumeAtomsSinceLastCheckpoint.get(market)! +
          Number(quoteAtoms),
      );
    });
  }

  /**
   * Initialize at the start with a get program accounts.
   */
  async initialize(): Promise<void> {
    const marketProgramAccounts: GetProgramAccountsResponse =
      await ManifestClient.getMarketProgramAccounts(this.connection);
    marketProgramAccounts.forEach(
      (
        value: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>,
      ) => {
        const marketPk: string = value.pubkey.toBase58();
        const market: Market = Market.loadFromBuffer({
          buffer: value.account.data,
          address: new PublicKey(marketPk),
        });
        // Skip markets that have never traded to keep the amount of data
        // retention smaller.
        if (Number(market.quoteVolume()) == 0) {
          return;
        }
        this.baseVolumeAtomsSinceLastCheckpoint.set(marketPk, 0);
        this.quoteVolumeAtomsSinceLastCheckpoint.set(marketPk, 0);
        this.baseVolumeAtomsCheckpoints.set(
          marketPk,
          new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
        );
        this.quoteVolumeAtomsCheckpoints.set(
          marketPk,
          new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0),
        );
        this.markets.set(marketPk, market);
      },
    );
  }

  /**
   * Periodically save the volume so a 24 hour rolling volume can be calculated.
   */
  saveCheckpoints(): void {
    console.log('Saving checkpoints');

    // Reset the websocket. It sometimes disconnects quietly, so just to be
    // safe, do it here.
    this.resetWebsocket();

    this.markets.forEach((value: Market, market: string) => {
      this.baseVolumeAtomsCheckpoints.set(market, [
        ...this.baseVolumeAtomsCheckpoints.get(market)!.slice(1),
        this.baseVolumeAtomsSinceLastCheckpoint.get(market)!,
      ]);
      this.baseVolumeAtomsSinceLastCheckpoint.set(market, 0);

      this.quoteVolumeAtomsCheckpoints.set(market, [
        ...this.quoteVolumeAtomsCheckpoints.get(market)!.slice(1),
        this.quoteVolumeAtomsSinceLastCheckpoint.get(market)!,
      ]);
      this.quoteVolumeAtomsSinceLastCheckpoint.set(market, 0);

      const baseMint: string = value.baseMint().toBase58();
      const quoteMint: string = value.quoteMint().toBase58();
      volume.set(
        { market, mint: baseMint, side: 'base' },
        this.baseVolumeAtomsCheckpoints
          .get(market)!
          .reduce((sum, num) => sum + num, 0),
      );
      volume.set(
        { market, mint: quoteMint, side: 'quote' },
        this.quoteVolumeAtomsCheckpoints
          .get(market)!
          .reduce((sum, num) => sum + num, 0),
      );
    });
  }

  /**
   * Periodically save to prometheus the depths of different market makers. This
   * is expensive, so it will only be run every few minutes at most. If we
   * wanted more frequent, should subscribe to market accounts. Because the
   * number of markets is unbounded, that is not done here.
   */
  async depthProbe(): Promise<void> {
    console.log('Probing depths for market maker data');

    // Once there are more than 200 accounts, should batch this into multiple fetches.
    const marketKeys: PublicKey[] = Array.from(this.markets.keys()).map(
      (market: string) => {
        return new PublicKey(market);
      },
    );

    try {
      const accountInfos: (AccountInfo<Buffer> | null)[] =
        await this.connection.getMultipleAccountsInfo(marketKeys);
      accountInfos.forEach(
        (accountInfo: AccountInfo<Buffer> | null, index: number) => {
          if (!accountInfo) {
            return;
          }
          const marketPk: PublicKey = marketKeys[index];
          const market: Market = Market.loadFromBuffer({
            buffer: accountInfo.data,
            address: marketPk,
          });
          const bids: RestingOrder[] = market.bids();
          const asks: RestingOrder[] = market.asks();
          if (bids.length == 0 || asks.length == 0) {
            return;
          }

          const mid: number =
            (bids[bids.length - 1].tokenPrice +
              asks[asks.length - 1].tokenPrice) /
            2;

          DEPTHS_BPS.forEach((depthBps: number) => {
            const bidsAtDepth: RestingOrder[] = bids.filter(
              (bid: RestingOrder) => {
                return bid.tokenPrice > mid * (1 - depthBps * 0.0001);
              },
            );
            const asksAtDepth: RestingOrder[] = asks.filter(
              (ask: RestingOrder) => {
                return ask.tokenPrice < mid * (1 + depthBps * 0.0001);
              },
            );

            const bidTraders: Set<string> = new Set(
              bidsAtDepth.map((bid: RestingOrder) => bid.trader.toBase58()),
            );

            bidTraders.forEach((trader: string) => {
              const bidTokensAtDepth: number = bidsAtDepth
                .filter((bid: RestingOrder) => {
                  return bid.trader.toBase58() == trader;
                })
                .map((bid: RestingOrder) => {
                  return Number(bid.numBaseTokens);
                })
                .reduce((sum, num) => sum + num, 0);
              const askTokensAtDepth: number = asksAtDepth
                .filter((ask: RestingOrder) => {
                  return ask.trader.toBase58() == trader;
                })
                .map((ask: RestingOrder) => {
                  return Number(ask.numBaseTokens);
                })
                .reduce((sum, num) => sum + num, 0);

              if (bidTokensAtDepth > 0 && askTokensAtDepth > 0) {
                depth.set(
                  {
                    depth_bps: depthBps,
                    market: marketPk.toBase58(),
                    trader: trader,
                  },
                  Math.min(bidTokensAtDepth, askTokensAtDepth),
                );
              }
            });
          });
        },
      );
    } catch (err) {
      console.log('Unable to fetch depth probe', err);
    }
  }

  /**
   * Get Tickers
   *
   * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0#heading=h.pa64vhp5pbih
   */
  getTickers() {
    const tickers: any = [];
    this.markets.forEach((market: Market, marketPk: string) => {
      tickers.push({
        ticker_id: marketPk,
        base_currency: market.baseMint().toBase58(),
        target_currency: market.quoteMint().toBase58(),
        last_price:
          this.lastPriceByMarket.get(marketPk)! *
          10 ** (market.baseDecimals() - market.quoteDecimals()),
        base_volume:
          this.baseVolumeAtomsCheckpoints
            .get(marketPk)!
            .reduce((sum, num) => sum + num, 0) /
          10 ** market.baseDecimals(),
        target_volume:
          this.quoteVolumeAtomsCheckpoints
            .get(marketPk)!
            .reduce((sum, num) => sum + num, 0) /
          10 ** market.quoteDecimals(),
        pool_id: marketPk,
        // Does not apply to orderbooks.
        liquidity_in_usd: 0,
        // Optional: not yet implemented
        // "bid": 0,
        // "ask": 0,
        // "high": 0,
        // "low": 0,
      });
    });
    return tickers;
  }

  /**
   * Get Orderbook
   *
   * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0#heading=h.vgzsfbx8rvps
   */
  async getOrderbook(tickerId: string, depth: number) {
    const market: Market = await Market.loadFromAddress({
      connection: this.connection,
      address: new PublicKey(tickerId),
    });
    if (depth == 0) {
      return {
        ticker_id: tickerId,
        bids: market
          .bids()
          .reverse()
          .map((restingOrder: RestingOrder) => {
            return [
              restingOrder.tokenPrice,
              Number(restingOrder.numBaseTokens),
            ];
          }),
        asks: market
          .asks()
          .reverse()
          .map((restingOrder: RestingOrder) => {
            return [
              restingOrder.tokenPrice,
              Number(restingOrder.numBaseTokens),
            ];
          }),
      };
    }
    const bids: RestingOrder[] = market.bids().reverse();
    const asks: RestingOrder[] = market.asks().reverse();
    const bidsUpToDepth: RestingOrder[] = [];
    const asksUpToDepth: RestingOrder[] = [];
    let bidTokens: number = 0;
    let askTokens: number = 0;
    bids.forEach((bid: RestingOrder) => {
      if (bidTokens < depth) {
        bidTokens += Number(bid.numBaseTokens);
        bidsUpToDepth.push(bid);
      }
    });
    asks.forEach((ask: RestingOrder) => {
      if (askTokens < depth) {
        askTokens += Number(ask.numBaseTokens);
        asksUpToDepth.push(ask);
      }
    });

    return {
      ticker_id: tickerId,
      bids: bidsUpToDepth.map((restingOrder: RestingOrder) => {
        return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
      }),
      asks: asksUpToDepth.reverse().map((restingOrder: RestingOrder) => {
        return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
      }),
    };
  }

  /**
   * Get Volume
   *
   * https://docs.llama.fi/list-your-project/other-dashboards/dimensions
   */
  async getVolume() {
    const marketProgramAccounts: GetProgramAccountsResponse =
      await ManifestClient.getMarketProgramAccounts(this.connection);
    const lifetimeVolume: number = marketProgramAccounts
      .map(
        (
          value: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>,
        ) => {
          const marketPk: string = value.pubkey.toBase58();
          const market: Market = Market.loadFromBuffer({
            buffer: value.account.data,
            address: new PublicKey(marketPk),
          });
          // Only track lifetime volume of USDC. We only track quote volume on a
          // market and this is the only token that is always quote. Other stables
          // could also be base when in stable pairs.
          if (
            market.quoteMint().toBase58() !=
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
          ) {
            return 0;
          }
          return Number(market.quoteVolume()) / 10 ** 6;
        },
      )
      .reduce((sum, num) => sum + num, 0);

    const dailyVolumesByToken: Map<string, number> = new Map();
    this.markets.forEach((market: Market, marketPk: string) => {
      const baseVolume: number =
        this.baseVolumeAtomsCheckpoints
          .get(marketPk)!
          .reduce((sum, num) => sum + num, 0) /
        10 ** market.baseDecimals();
      const quoteVolume: number =
        this.quoteVolumeAtomsCheckpoints
          .get(marketPk)!
          .reduce((sum, num) => sum + num, 0) /
        10 ** market.quoteDecimals();
      const baseMint: string = 'solana:' + market.baseMint().toBase58();
      const quoteMint: string = 'solana:' + market.quoteMint().toBase58();
      if (baseVolume == 0 || quoteVolume == 0) {
        return;
      }
      if (!dailyVolumesByToken.has(baseMint)) {
        dailyVolumesByToken.set(baseMint, 0);
      }
      if (!dailyVolumesByToken.has(quoteMint)) {
        dailyVolumesByToken.set(quoteMint, 0);
      }
      dailyVolumesByToken.set(
        baseMint,
        dailyVolumesByToken.get(baseMint)! + baseVolume,
      );
      dailyVolumesByToken.set(
        quoteMint,
        dailyVolumesByToken.get(quoteMint)! + quoteVolume,
      );
    });

    return {
      totalVolume: {
        'solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': lifetimeVolume,
      },
      dailyVolume: Object.fromEntries(dailyVolumesByToken),
    };
  }
}

const run = async () => {
  promClient.collectDefaultMetrics({
    labels: {
      app: 'stats',
    },
  });

  const register = new promClient.Registry();
  register.setDefaultLabels({
    app: 'stats',
  });
  const metricsApp = express();
  metricsApp.listen(9090);

  const promMetrics = promBundle({
    includeMethod: true,
    metricsApp,
    autoregister: false,
  });
  metricsApp.use(promMetrics);

  const statsServer: ManifestStatsServer = new ManifestStatsServer();
  await statsServer.initialize();

  const tickersHandler: RequestHandler = (_req, res) => {
    res.send(statsServer.getTickers());
  };
  const orderbookHandler: RequestHandler = async (req, res) => {
    res.send(
      await statsServer.getOrderbook(
        req.query.ticker_id as string,
        Number(req.query.depth),
      ),
    );
  };
  const volumeHandler: RequestHandler = async (_req, res) => {
    res.send(await statsServer.getVolume());
  };
  const app = express();
  app.get('/tickers', tickersHandler);
  app.get('/orderbook', orderbookHandler);
  app.get('/volume', volumeHandler);
  app.listen(Number(PORT!));

  while (true) {
    statsServer.saveCheckpoints();
    // Promise.all here so depth probing doesnt get the save checkpoints off
    // schedule. Could be done with separate setInterval instead.
    await Promise.all([
      statsServer.depthProbe(),
      sleep(CHECKPOINT_DURATION_SEC * 1_000),
    ]);
  }
};

run().catch((e) => {
  console.error('fatal error');
  throw e;
});
