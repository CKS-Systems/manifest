import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';

import { FillLog } from './manifest/accounts/FillLog';
import { PROGRAM_ID } from './manifest';
import { convertU128 } from './utils/numbers';
import * as promClient from 'prom-client';
import { FillLogResult } from './types';
import {
  fillDiscriminant,
  toFillLogResult,
  detectAggregatorFromKeys,
  detectOriginatingProtocolFromKeys,
} from './fillFeed';
import { WebSocketManager } from './utils/WebSocketManager';

// For live monitoring of the fill feed. For a more complete look at fill
// history stats, need to index all trades.
const fills = new promClient.Counter({
  name: 'fills_geyser',
  help: 'Number of fills from Geyser stream',
  labelNames: ['market', 'isGlobal', 'takerIsBuy'] as const,
});

interface GeyserSubscriptionRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface GeyserTransaction {
  signature: string;
  slot: number;
  transaction: {
    message: {
      accountKeys: string[];
      recentBlockhash: string;
      instructions: Array<{
        programIdIndex: number;
        accounts: number[];
        data: string;
      }>;
    };
  };
  meta?: {
    err?: any;
    logMessages?: string[];
    postBalances?: number[];
    preBalances?: number[];
  };
  blockTime?: number;
}

interface GeyserNotification {
  jsonrpc: '2.0';
  method: 'transactionNotification';
  params: {
    result: {
      transaction: GeyserTransaction;
    };
    subscription: number;
  };
}

/**
 * FillFeedBlockSub - Subscribes to Geyser stream for all Manifest program transactions
 */
export class FillFeedBlockSub {
  private wsManager: WebSocketManager;
  private geyserWs: WebSocket | null = null;
  private shouldEnd: boolean = false;
  private ended: boolean = false;
  private lastUpdateUnix: number = Date.now();
  private geyserUrl: string;
  private subscriptionId: number | null = null;
  private reconnectDelay: number = 5000; // 5 seconds
  private maxReconnectDelay: number = 300000; // 5 minutes
  private currentReconnectDelay: number = this.reconnectDelay;

  constructor(
    private connection: Connection,
    geyserUrl: string,
    wsPort: number = 1234,
  ) {
    this.geyserUrl = geyserUrl;
    this.wsManager = new WebSocketManager(wsPort, 30000);
  }

  public msSinceLastUpdate() {
    return Date.now() - this.lastUpdateUnix;
  }

  public async stop() {
    this.shouldEnd = true;

    // Unsubscribe from Geyser if connected
    if (this.geyserWs && this.subscriptionId !== null) {
      try {
        const unsubscribeRequest: GeyserSubscriptionRequest = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'transactionUnsubscribe',
          params: [this.subscriptionId],
        };
        this.geyserWs.send(JSON.stringify(unsubscribeRequest));
      } catch (error) {
        console.error('Error unsubscribing from Geyser:', error);
      }
    }

    // Close Geyser connection
    if (this.geyserWs) {
      this.geyserWs.close();
      this.geyserWs = null;
    }

    // Close WebSocket server
    this.wsManager.close();
    this.ended = true;
  }

  /**
   * Connect to Geyser and subscribe to Manifest program transactions
   */
  public async start() {
    while (!this.shouldEnd) {
      try {
        await this.connectToGeyser();
        await this.subscribeToManifestTransactions();

        // Reset reconnect delay on successful connection
        this.currentReconnectDelay = this.reconnectDelay;

        // Wait for disconnection or stop signal
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (
              this.shouldEnd ||
              !this.geyserWs ||
              this.geyserWs.readyState !== WebSocket.OPEN
            ) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 1000);
        });
      } catch (error) {
        console.error('Error in Geyser connection:', error);

        // Exponential backoff for reconnection
        console.log(
          `Reconnecting in ${this.currentReconnectDelay / 1000} seconds...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.currentReconnectDelay),
        );
        this.currentReconnectDelay = Math.min(
          this.currentReconnectDelay * 2,
          this.maxReconnectDelay,
        );
      }
    }

    console.log('FillFeedBlockSub ended');
  }

  private async connectToGeyser(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`Connecting to Geyser at ${this.geyserUrl}`);

      this.geyserWs = new WebSocket(this.geyserUrl);

      const connectionTimeout = setTimeout(() => {
        if (
          this.geyserWs &&
          this.geyserWs.readyState !== WebSocket.OPEN
        ) {
          this.geyserWs.close();
          reject(new Error('Geyser connection timeout'));
        }
      }, 30000);

      this.geyserWs.on('open', () => {
        clearTimeout(connectionTimeout);
        console.log('Connected to Geyser');
        resolve();
      });

      this.geyserWs.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleGeyserMessage(message);
        } catch (error) {
          console.error('Error parsing Geyser message:', error);
        }
      });

      this.geyserWs.on('error', (error) => {
        clearTimeout(connectionTimeout);
        console.error('Geyser WebSocket error:', error);
        reject(error);
      });

      this.geyserWs.on('close', () => {
        console.log('Geyser connection closed');
        this.subscriptionId = null;
      });
    });
  }

  private async subscribeToManifestTransactions(): Promise<void> {
    if (!this.geyserWs || this.geyserWs.readyState !== WebSocket.OPEN) {
      throw new Error('Geyser WebSocket not connected');
    }

    const subscriptionRequest: GeyserSubscriptionRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'transactionSubscribe',
      params: [
        {
          // Subscribe to all transactions that mention the Manifest program
          mentions: [PROGRAM_ID.toBase58()],
          // Optionally add other filters
          failed: false,
          commitment: 'confirmed',
        },
        {
          // Request full transaction details
          encoding: 'json',
          transactionDetails: 'full',
          showRewards: false,
        },
      ],
    };

    return new Promise((resolve, reject) => {
      const subscriptionTimeout = setTimeout(() => {
        reject(new Error('Subscription timeout'));
      }, 10000);

      // Set up one-time handler for subscription response
      const handleSubscriptionResponse = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === subscriptionRequest.id) {
            if (response.result) {
              this.subscriptionId = response.result;
              console.log(
                `Subscribed to Manifest transactions with ID: ${this.subscriptionId}`,
              );
              clearTimeout(subscriptionTimeout);
              resolve();
            } else if (response.error) {
              clearTimeout(subscriptionTimeout);
              reject(
                new Error(
                  `Subscription error: ${JSON.stringify(response.error)}`,
                ),
              );
            }
          }
        } catch (error) {
          // Not the subscription response, ignore
        }
      };

      this.geyserWs!.once('message', handleSubscriptionResponse);
      this.geyserWs!.send(JSON.stringify(subscriptionRequest));
    });
  }

  private handleGeyserMessage(message: any) {
    if (message.method === 'transactionNotification') {
      const notification = message as GeyserNotification;
      this.handleTransaction(notification.params.result.transaction);
    }
  }

  private async handleTransaction(tx: GeyserTransaction) {
    console.log('Handling transaction', tx.signature, 'slot', tx.slot);

    if (!tx.meta?.logMessages) {
      console.log('No log messages');
      return;
    }
    if (tx.meta.err != null) {
      console.log('Skipping failed tx', tx.signature);
      return;
    }

    // Extract signers
    const accountKeys = tx.transaction.message.accountKeys;
    const originalSigner = accountKeys[0];
    // In Geyser format, we need to determine signers differently
    // For now, we'll use the first account key as the signer
    const signers = [originalSigner];

    const aggregator = detectAggregatorFromKeys(accountKeys);
    const originatingProtocol = detectOriginatingProtocolFromKeys(accountKeys);

    const messages: string[] = tx.meta.logMessages;
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
        tx.slot,
        tx.signature,
        originalSigner,
        aggregator,
        originatingProtocol,
        signers,
        tx.blockTime,
      );
      const resultString: string = JSON.stringify(fillResult);
      console.log('Got a fill', resultString);
      fills.inc({
        market: deserializedFillLog.market.toString(),
        isGlobal: deserializedFillLog.isMakerGlobal.toString(),
        takerIsBuy: deserializedFillLog.takerIsBuy.toString(),
      });

      // Update last update time
      this.lastUpdateUnix = Date.now();

      // Send to all connected clients
      this.wsManager.broadcast(JSON.stringify(fillResult));
    }
  }
}