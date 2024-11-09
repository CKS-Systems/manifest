import WebSocket from 'ws';
import { sleep } from '@/lib/util';
import * as promClient from 'prom-client';
import express, { RequestHandler } from 'express';
import promBundle from 'express-prom-bundle';
import { AccountInfo, Connection, GetProgramAccountsResponse, PublicKey } from "@solana/web3.js"
import { FillLogResult, ManifestClient, Market, RestingOrder } from '@cks-systems/manifest-sdk';

//const CHECKPOINT_DURATION_SEC: number = 60 * 60;
const CHECKPOINT_DURATION_SEC: number = 60;
const ONE_DAY_SEC: number = 24 * 60 * 60;
const PORT: number = 3000;

const { RPC_URL } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

/**
 * Server for serving stats according to this spec:
 * https://docs.google.com/document/d/1v27QFoQq1SKT3Priq3aqPgB70Xd_PnDzbOCiuoCyixw/edit?tab=t.0
 */
export class ManifestStatsServer {
    private connection: Connection;
    private ws: WebSocket;
    // Base and quote volume
    private baseVolumeAtomsByMarketSinceLastCheckpoint: Map<string, number> = new Map();
    private quoteVolumeAtomsByMarketSinceLastCheckpoint: Map<string, number> = new Map();

    // Hourly checkpoints
    private baseVolumeAtomsCheckpoints: Map<string, number[]> = new Map();
    private quoteVolumeAtomsCheckpoints: Map<string, number[]> = new Map();

    // Last price by market
    private lastPriceByMarket: Map<string, number> = new Map();
  
    // Market objects used for mints and decimals.
    private markets: Map<string, Market> = new Map();

    constructor() {
      this.ws = new WebSocket("wss://mfx-feed-mainnet.fly.dev");
      this.connection = new Connection(RPC_URL!);
  
      this.ws.on('open', () => {});

      this.ws.on('close', () => {
        console.log('Disconnected. Reconnecting');
        this.ws = new WebSocket("wss://mfx-feed-mainnet.fly.dev");
        // TODO: Prometheus
      });
      this.ws.on('error', () => {
        console.log('Error. Reconnecting');
        // TODO: Prometheus
      });

      this.ws.on('message', async (message) => {
        const fill: FillLogResult = JSON.parse(message.toString());
        const {
          market,
          baseAtoms,
          quoteAtoms,
          price,
        } = fill;

        const marketPk: PublicKey = new PublicKey(market);
        if (this.markets.get(market) == undefined) {
          this.baseVolumeAtomsByMarketSinceLastCheckpoint.set(market, 0);
          this.quoteVolumeAtomsByMarketSinceLastCheckpoint.set(market, 0);
          this.baseVolumeAtomsCheckpoints.set(market, new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0));
          this.quoteVolumeAtomsCheckpoints.set(market, new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0));
          this.markets.set(
            market,
            await Market.loadFromAddress({ connection: this.connection, address: marketPk})
          );
        }

        this.lastPriceByMarket.set(market, price);
        this.baseVolumeAtomsByMarketSinceLastCheckpoint.set(
            market,
            this.baseVolumeAtomsByMarketSinceLastCheckpoint.get(market)! + Number(baseAtoms)
        );
        this.quoteVolumeAtomsByMarketSinceLastCheckpoint.set(
            market,
            this.quoteVolumeAtomsByMarketSinceLastCheckpoint.get(market)! + Number(quoteAtoms)
        );

        // TODO: Prometheus for fill.
      });
    }

    /**
     * Initialize at the start with a get program accounts.
     */
    async initialize(): Promise<void> {
      const marketProgramAccounts: GetProgramAccountsResponse = await ManifestClient.getMarketProgramAccounts(this.connection);
      marketProgramAccounts.forEach(
        (
          value: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey; }>,
        ) => {
          const marketPk: string = value.pubkey.toBase58();
          const market: Market = Market.loadFromBuffer({ buffer: value.account.data, address: new PublicKey(marketPk)});
          if (Number(market.quoteVolume()) == 0) {
            return;
          }
          this.baseVolumeAtomsByMarketSinceLastCheckpoint.set(marketPk, 0);
          this.quoteVolumeAtomsByMarketSinceLastCheckpoint.set(marketPk, 0);
          this.baseVolumeAtomsCheckpoints.set(marketPk, new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0));
          this.quoteVolumeAtomsCheckpoints.set(marketPk, new Array<number>(ONE_DAY_SEC / CHECKPOINT_DURATION_SEC).fill(0));
          this.markets.set(marketPk, market);
        }
      );
    }

    saveCheckpoints(): void {
        this.markets.forEach(
            (_value: Market, marketPk: string) => {
                this.baseVolumeAtomsCheckpoints.set(
                    marketPk,
                    [this.baseVolumeAtomsByMarketSinceLastCheckpoint.get(marketPk)!, ...this.baseVolumeAtomsCheckpoints.get(marketPk)!.slice(1)]
                );
                this.baseVolumeAtomsByMarketSinceLastCheckpoint.set(marketPk, 0);

                this.quoteVolumeAtomsCheckpoints.set(
                    marketPk,
                    [this.quoteVolumeAtomsByMarketSinceLastCheckpoint.get(marketPk)!, ...this.quoteVolumeAtomsCheckpoints.get(marketPk)!.slice(1)]
                );
                this.quoteVolumeAtomsByMarketSinceLastCheckpoint.set(marketPk, 0);
            }
        );
        // TODO: Prometheus metric for most recent checkpoint.
    }

    getTickers() {
      const tickers: any = [];
      this.markets.forEach(
            (market: Market, marketPk: string) => {
              tickers.push({
                "ticker_id": marketPk,
                "base_currency": market.baseMint().toBase58(),
                "target_currency": market.quoteMint().toBase58(),
                "last_price": this.lastPriceByMarket.get(marketPk)! * 10 ** (market.baseDecimals() - market.quoteDecimals()),
                "base_volume": this.baseVolumeAtomsCheckpoints.get(marketPk)!.reduce((sum, num) => sum + num, 0) / 10 ** market.baseDecimals(),
                "target_volume": this.quoteVolumeAtomsCheckpoints.get(marketPk)!.reduce((sum, num) => sum + num, 0) / 10 ** market.quoteDecimals(),
                "pool_id": marketPk,
                // Does not apply to orderbooks.
                "liquidity_in_usd": 0,
                // Not yet implemented
                // "bid": 0,
                // "ask": 0,
                // "high": 0,
                // "low": 0,
              })
            }
      );
      return tickers;
    }

    async getOrderbook(tickerId: string, depth: number) {
      const market: Market = await Market.loadFromAddress({ connection: this.connection, address: new PublicKey(tickerId)});
      if (depth == 0) {
        return {
          "ticker_id": tickerId,
          "bids": market.bids().reverse().map(
            (restingOrder: RestingOrder) => {
              return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
            }
          ),
          "asks": market.asks().reverse().map(
            (restingOrder: RestingOrder) => {
              return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
            }
          )
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
        "ticker_id": tickerId,
        "bids": bidsUpToDepth.map(
          (restingOrder: RestingOrder) => {
            return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
          }
        ),
        "asks": asksUpToDepth.reverse().map(
          (restingOrder: RestingOrder) => {
            return [restingOrder.tokenPrice, Number(restingOrder.numBaseTokens)];
          }
        )
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
      res.send(await statsServer.getOrderbook(req.query.ticker_id as string, Number(req.query.depth)));
    };
    const app = express();
    app.get("/tickers", tickersHandler);
    app.get("/orderbook", orderbookHandler);
    app.listen(Number(PORT!));

    while (true) {
      statsServer.saveCheckpoints()
      await sleep(CHECKPOINT_DURATION_SEC * 1_000);
    }
  };

  run().catch((e) => {
    console.error('fatal error');
    throw e;
  });