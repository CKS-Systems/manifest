import WebSocket from 'ws';
import {
  Connection,
  ConfirmedSignatureInfo,
  VersionedTransactionResponse,
} from '@solana/web3.js';

import { FillLog } from './manifest/accounts/FillLog';
import { PROGRAM_ID } from './manifest';
import { convertU128 } from './utils/numbers';
import { genAccDiscriminator } from './utils/discriminator';
import * as promClient from 'prom-client';
import { FillLogResult } from './types';

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
  private shouldEnd: boolean = false;
  private ended: boolean = false;
  private lastUpdateUnix: number = Date.now();

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

  public msSinceLastUpdate() {
    return Date.now() - this.lastUpdateUnix;
  }

  public async stopParseLogs() {
    this.shouldEnd = true;
    const start = Date.now();
    while (!this.ended) {
      const timeout = 30_000;
      const pollInterval = 500;

      if (Date.now() - start > timeout) {
        return Promise.reject(
          new Error(
            `failed to stop parseLogs after ${timeout / 1_000} seconds`,
          ),
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return Promise.resolve();
  }

  /**
   * Parse logs in an endless loop.
   */
  public async parseLogs(endEarly?: boolean) {
    // Start with a hopefully recent signature.
    const lastSignatureStatus = (
      await this.connection.getSignaturesForAddress(
        PROGRAM_ID,
        { limit: 1 },
        'finalized',
      )
    )[0];
    let lastSignature: string | undefined = lastSignatureStatus.signature;
    let lastSlot: number = lastSignatureStatus.slot;

    // End early is 30 seconds, used for testing.
    const endTime: Date = endEarly
      ? new Date(Date.now() + 30_000)
      : new Date(Date.now() + 1_000_000_000_000);

    // TODO: remove endTime in favor of stopParseLogs for testing
    while (!this.shouldEnd && new Date(Date.now()) < endTime) {
      await new Promise((f) => setTimeout(f, 10_000));
      const signatures: ConfirmedSignatureInfo[] =
        await this.connection.getSignaturesForAddress(
          PROGRAM_ID,
          {
            until: lastSignature,
          },
          'finalized',
        );
      // Flip it so we do oldest first.
      signatures.reverse();

      // Process even single signatures, but handle the edge case differently
      if (signatures.length === 0) {
        continue;
      }

      // If we only got back the same signature we already processed, skip it
      if (
        signatures.length === 1 &&
        signatures[0].signature === lastSignature
      ) {
        continue;
      }
      for (const signature of signatures) {
        // Skip if we already processed this signature
        if (signature.signature === lastSignature) {
          continue;
        }

        // Separately track the last slot. This is necessary because sometimes
        // gsfa ignores the until param and just gives 1_000 signatures.
        if (signature.slot < lastSlot) {
          continue;
        }
        await this.handleSignature(signature);
      }

      console.log(
        'New last signature:',
        signatures[signatures.length - 1].signature,
        'New last signature slot:',
        signatures[signatures.length - 1].slot,
        'num sigs',
        signatures.length,
      );
      lastSignature = signatures[signatures.length - 1].signature;
      lastSlot = signatures[signatures.length - 1].slot;

      this.lastUpdateUnix = Date.now();
    }

    console.log('ended loop');
    this.wss.close();
    this.ended = true;
  }

  /**
   * Handle a signature by fetching the tx onchain and possibly sending a fill
   * notification.
   */
  private async handleSignature(signature: ConfirmedSignatureInfo) {
    console.log('Handling', signature.signature, 'slot', signature.slot);
    const tx = await this.connection.getTransaction(signature.signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta?.logMessages) {
      console.log('No log messages');
      return;
    }
    if (tx.meta.err != null) {
      console.log('Skipping failed tx', signature.signature);
      return;
    }

    // Extract the original signer (fee payer/first signer) and all signers
    let originalSigner: string | undefined;
    let signers: string[] | undefined;
    try {
      const message = tx.transaction.message;

      if ('accountKeys' in message) {
        // Legacy transaction
        originalSigner = message.accountKeys[0]?.toBase58();
        // Extract all signers using isAccountSigner method
        signers = message.accountKeys
          .map((key, index) => ({ key, index }))
          .filter(({ index }) => message.isAccountSigner(index))
          .map(({ key }) => key.toBase58());
      } else {
        // Versioned transaction (v0) - use staticAccountKeys for the main accounts
        originalSigner = message.staticAccountKeys[0]?.toBase58();
        // Extract all signers using isAccountSigner method
        signers = message.staticAccountKeys
          .map((key, index) => ({ key, index }))
          .filter(({ index }) => message.isAccountSigner(index))
          .map(({ key }) => key.toBase58());
      }
    } catch (error) {
      console.error('Error extracting signers:', error);
    }

    const aggregator: string | undefined = detectAggregator(tx);
    const originatingProtocol: string | undefined =
      detectOriginatingProtocol(tx);

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
      if (!buffer.subarray(0, 8).equals(fillDiscriminant)) {
        continue;
      }
      const deserializedFillLog: FillLog = FillLog.deserialize(
        buffer.subarray(8),
      )[0];
      const fillResult = toFillLogResult(
        deserializedFillLog,
        signature.slot,
        signature.signature,
        originalSigner,
        aggregator,
        originatingProtocol,
        signers,
        signature.blockTime ?? undefined,
      );
      const resultString: string = JSON.stringify(fillResult);
      console.log('Got a fill', resultString);
      fills.inc({
        market: deserializedFillLog.market.toString(),
        isGlobal: deserializedFillLog.isMakerGlobal.toString(),
        takerIsBuy: deserializedFillLog.takerIsBuy.toString(),
      });
      this.wss.clients.forEach((client) => {
        client.send(JSON.stringify(fillResult));
      });
    }
  }
}

function detectAggregator(
  tx: VersionedTransactionResponse,
): string | undefined {
  // Look for the aggregator program id from a list of known ids.
  try {
    // For versioned transactions, we need to handle both static and resolved account keys
    const message = tx.transaction.message;

    // Handle both legacy and versioned transactions
    if ('accountKeys' in message) {
      // Legacy transaction
      for (const account of message.accountKeys) {
        if (
          account.toBase58() == 'MEXkeo4BPUCZuEJ4idUUwMPu4qvc9nkqtLn3yAyZLxg'
        ) {
          return 'Swissborg';
        }
        if (
          account.toBase58() == 'T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT'
        ) {
          return 'Titan';
        }
        if (
          account.toBase58() ==
            '6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma' ||
          account.toBase58() == 'proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u'
        ) {
          return 'OKX';
        }
        if (
          account.toBase58() == 'DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH'
        ) {
          return 'DFlow';
        }
        if (
          account.toBase58() == 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
        ) {
          return 'Jupiter';
        }
        if (
          account.toBase58() == 'SPURp82qAR9nvzy8j1gP31zmzGytrgDBKcpGzeGkka8'
        ) {
          return 'Spur';
        }
      }
    } else {
      // V0 transaction - use staticAccountKeys directly to avoid lookup resolution issues
      for (const account of message.staticAccountKeys) {
        if (
          account.toBase58() == 'MEXkeo4BPUCZuEJ4idUUwMPu4qvc9nkqtLn3yAyZLxg'
        ) {
          return 'Swissborg';
        }
        if (
          account.toBase58() == 'T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT'
        ) {
          return 'Titan';
        }
        if (
          account.toBase58() ==
            '6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma' ||
          account.toBase58() == 'proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u'
        ) {
          return 'OKX';
        }
        if (
          account.toBase58() == 'DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH'
        ) {
          return 'DFlow';
        }
        if (
          account.toBase58() == 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
        ) {
          return 'Jupiter';
        }
        if (
          account.toBase58() == 'SPURp82qAR9nvzy8j1gP31zmzGytrgDBKcpGzeGkka8'
        ) {
          return 'Spur';
        }
      }
    }
  } catch (error) {
    console.warn('Error detecting aggregator:', error);
    // Fall back to undefined if we can't detect the aggregator
  }
  return undefined;
}

function detectOriginatingProtocol(
  tx: VersionedTransactionResponse,
): string | undefined {
  // Look for known originating protocol program IDs in the transaction accounts
  const KAMINO_PROGRAM_ID = 'LiMoM9rMhrdYrfzUCxQppvxCSG1FcrUK9G8uLq4A1GF';
  const CABANA_PROGRAM_ID = 'UMnFStVeG1ecZFc2gc5K3vFy3sMpotq8C91mXBQDGwh';
  const JUP_3_PROGRAM_ID = 'HU23r7UoZbqTUuh3vA7emAGztFtqwTeVips789vqxxBw';
  const PHANTOM_FEES_ID = '9yj3zvLS3fDMqi1F8zhkaWfq8TZpZWHe6cz1Sgt7djXf';
  const PHANTOM_FEES_ID_2 = '8psNvWTrdNTiVRNzAgsou9kETXNJm2SXZyaKuJraVRtf';

  try {
    const message = tx.transaction.message;

    // Handle both legacy and versioned transactions
    if ('accountKeys' in message) {
      // Legacy transaction
      for (const account of message.accountKeys) {
        const accountKey = account.toBase58();
        if (
          accountKey === PHANTOM_FEES_ID ||
          accountKey === PHANTOM_FEES_ID_2
        ) {
          return 'phantom';
        }
        if (accountKey === KAMINO_PROGRAM_ID) {
          return 'kamino';
        }
        if (accountKey === CABANA_PROGRAM_ID) {
          return 'cabana';
        }
        if (accountKey === JUP_3_PROGRAM_ID) {
          return 'jupiter';
        }
      }
    } else {
      // V0 transaction - use staticAccountKeys directly to avoid lookup resolution issues
      for (const account of message.staticAccountKeys) {
        const accountKey = account.toBase58();
        if (
          accountKey === PHANTOM_FEES_ID ||
          accountKey === PHANTOM_FEES_ID_2
        ) {
          return 'phantom';
        }
        if (accountKey === KAMINO_PROGRAM_ID) {
          return 'kamino';
        }
        if (accountKey === CABANA_PROGRAM_ID) {
          return 'cabana';
        }
        if (accountKey === JUP_3_PROGRAM_ID) {
          return 'jupiter';
        }
      }
    }
  } catch (error) {
    console.warn('Error detecting originating protocol:', error);
    // Fall back to undefined if we can't detect the originating protocol
  }
  return undefined;
}

const fillDiscriminant = genAccDiscriminator('manifest::logs::FillLog');

function toFillLogResult(
  fillLog: FillLog,
  slot: number,
  signature: string,
  originalSigner?: string,
  aggregator?: string,
  originatingProtocol?: string,
  signers?: string[],
  blockTime?: number,
): FillLogResult {
  const result: FillLogResult = {
    market: fillLog.market.toBase58(),
    maker: fillLog.maker.toBase58(),
    taker: fillLog.taker.toBase58(),
    baseAtoms: fillLog.baseAtoms.inner.toString(),
    quoteAtoms: fillLog.quoteAtoms.inner.toString(),
    priceAtoms: convertU128(fillLog.price.inner),
    takerIsBuy: fillLog.takerIsBuy,
    isMakerGlobal: fillLog.isMakerGlobal,
    makerSequenceNumber: fillLog.makerSequenceNumber.toString(),
    takerSequenceNumber: fillLog.takerSequenceNumber.toString(),
    signature,
    slot,
  };

  if (originalSigner) {
    result.originalSigner = originalSigner;
  }
  if (aggregator) {
    result.aggregator = aggregator;
  }
  if (originatingProtocol) {
    result.originatingProtocol = originatingProtocol;
  }
  if (signers && signers.length > 0) {
    result.signers = signers;
  }
  if (blockTime !== undefined) {
    result.blockTime = blockTime;
  }

  return result;
}
