import WebSocket from 'ws';
import { Connection, ConfirmedSignatureInfo } from '@solana/web3.js';

import { FillLog } from './manifest/accounts/FillLog';
import { PROGRAM_ID } from './manifest';
import { convertU128 } from './utils/numbers';
import bs58 from 'bs58';
import keccak256 from 'keccak256';
import * as promClient from 'prom-client';
import express from 'express';
import promBundle from 'express-prom-bundle';

// For live monitoring of the fill feed. For a more complete look at fill
// history stats, need to index all trades.
const fills = new promClient.Counter({
  name: 'fills',
  help: 'Number of fills',
  labelNames: ['market', 'isGlobal', 'takerIsBuy'] as const,
});

/**
 * FillFeed example implementation.
 */
export class FillFeed {
  private wss: WebSocket.Server;
  constructor(private connection: Connection) {
    this.wss = new WebSocket.Server({ port: 1234 });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New client connected');

      ws.on('message', (message: string) => {
        console.log(`Received message: ${message}`);
      });

      ws.on('close', () => {
        console.log('Client disconnected');
      });
    });
  }

  /**
   * Parse logs in an endless loop.
   */
  public async parseLogs(endEarly?: boolean) {
    // Start with a hopefully recent signature.
    let lastSignature: string | undefined = (
      await this.connection.getSignaturesForAddress(PROGRAM_ID)
    )[0].signature;

    // End early is 30 seconds, used for testing.
    const endTime: Date = endEarly
      ? new Date(Date.now() + 30_000)
      : new Date(Date.now() + 1_000_000_000_000);

    while (new Date(Date.now()) < endTime) {
      await new Promise((f) => setTimeout(f, 10_000));
      const signatures: ConfirmedSignatureInfo[] =
        await this.connection.getSignaturesForAddress(PROGRAM_ID, {
          until: lastSignature,
        });
      // Flip it so we do oldest first.
      signatures.reverse();
      if (signatures.length == 0) {
        continue;
      }
      lastSignature = signatures[signatures.length - 1].signature;

      for (const signature of signatures) {
        await this.handleSignature(signature);
      }
    }
    this.wss.close();
  }

  /**
   * Handle a signature by fetching the tx onchain and possibly sending a fill
   * notification.
   */
  private async handleSignature(signature: ConfirmedSignatureInfo) {
    console.log('Handling', signature.signature);
    const tx = await this.connection.getTransaction(signature.signature)!;
    if (!tx?.meta?.logMessages) {
      console.log('No log messages');
      return;
    }
    if (tx.meta.err != null) {
      console.log('Skipping failed tx');
      return;
    }

    const messages: string[] = tx?.meta?.logMessages!;
    const programDatas: string[] = messages.filter((message) => {
      return message.includes('Program data:');
    });

    if (programDatas.length == 0) {
      console.log('No program datas');
      return;
    }

    for (const programDataEntry of programDatas) {
      const programData = programDataEntry.split(' ')[2];
      const byteArray: Uint8Array = Uint8Array.from(atob(programData), (c) =>
        c.charCodeAt(0),
      );
      const buffer = Buffer.from(byteArray);
      // Hack to fix the difference in caching on the CI action.
      if (
        !buffer.subarray(0, 8).equals(fillDiscriminant) &&
        !buffer
          .subarray(0, 8)
          .equals(Buffer.from([52, 81, 147, 82, 119, 191, 72, 172]))
      ) {
        continue;
      }
      const deserializedFillLog: FillLog = FillLog.deserialize(
        buffer.subarray(8),
      )[0];
      const resultString: string = JSON.stringify(
        toFillLogResult(deserializedFillLog, signature.slot),
      );
      console.log('Got a fill', resultString);
      fills.inc({
        market: deserializedFillLog.market.toString(),
        isGlobal: deserializedFillLog.isMakerGlobal.toString(),
        takerIsBuy: deserializedFillLog.takerIsBuy.toString(),
      });
      this.wss.clients.forEach((client) => {
        client.send(
          JSON.stringify(toFillLogResult(deserializedFillLog, signature.slot)),
        );
      });
    }
  }
}

/**
 * Run a fill feed as a websocket server that clients can connect to and get
 * notifications of fills for all manifest markets.
 */
export async function runFillFeed() {
  const connection: Connection = new Connection(
    process.env.RPC_URL || 'http://127.0.0.1:8899',
    'confirmed',
  );

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
  metricsApp.listen(8080);

  const promMetrics = promBundle({
    includeMethod: true,
    metricsApp,
    autoregister: false,
  });
  metricsApp.use(promMetrics);

  const fillFeed: FillFeed = new FillFeed(connection);
  await fillFeed.parseLogs();
}

/**
 * Helper function for getting account discriminator that matches how anchor
 * generates discriminators.
 */
function genAccDiscriminator(accName: string) {
  return keccak256(
    Buffer.concat([
      Buffer.from(bs58.decode(PROGRAM_ID.toBase58())),
      Buffer.from('manifest::logs::'),
      Buffer.from(accName),
    ]),
  ).subarray(0, 8);
}
const fillDiscriminant = genAccDiscriminator('FillLog');

/**
 * FillLogResult is the message sent to subscribers of the FillFeed
 */
export type FillLogResult = {
  /** Public key for the market as base58. */
  market: string;
  /** Public key for the maker as base58. */
  maker: string;
  /** Public key for the taker as base58. */
  taker: string;
  /** Number of base atoms traded. */
  baseAtoms: string;
  /** Number of quote atoms traded. */
  quoteAtoms: string;
  /** Price as float. Quote atoms per base atom. */
  price: number;
  /** Boolean to indicate which side the trade was. */
  takerIsBuy: boolean;
  /** Boolean to indicate whether the maker side is global. */
  isMakerGlobal: boolean;
  /** Sequential number for every order placed / matched wraps around at u64::MAX */
  makerSequenceNumber: string;
  /** Sequential number for every order placed / matched wraps around at u64::MAX */
  takerSequenceNumber: string;
  /** Slot number of the fill. */
  slot: number;
};
function toFillLogResult(fillLog: FillLog, slot: number): FillLogResult {
  return {
    market: fillLog.market.toBase58(),
    maker: fillLog.maker.toBase58(),
    taker: fillLog.taker.toBase58(),
    baseAtoms: fillLog.baseAtoms.inner.toString(),
    quoteAtoms: fillLog.quoteAtoms.inner.toString(),
    price: convertU128(fillLog.price.inner),
    takerIsBuy: fillLog.takerIsBuy,
    isMakerGlobal: fillLog.isMakerGlobal,
    makerSequenceNumber: fillLog.makerSequenceNumber.toString(),
    takerSequenceNumber: fillLog.takerSequenceNumber.toString(),
    slot,
  };
}
