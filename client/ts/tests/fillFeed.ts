import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { OrderType } from '../src/manifest/types';
import { createMarket } from './createMarket';
import { deposit } from './deposit';
import { Market } from '../src/market';
import { assert } from 'chai';
import { FillFeed } from '../src';
import { placeOrder } from './placeOrder';
import WebSocket from 'ws';

async function testFillFeed(): Promise<void> {
  const connection: Connection = new Connection('http://127.0.0.1:8899');
  const payerKeypair: Keypair = Keypair.generate();

  const marketAddress: PublicKey = await createMarket(connection, payerKeypair);
  const market: Market = await Market.loadFromAddress({
    connection,
    address: marketAddress,
  });

  // Deposit and place the first order.
  await deposit(connection, payerKeypair, marketAddress, market.baseMint(), 10);
  await deposit(
    connection,
    payerKeypair,
    marketAddress,
    market.quoteMint(),
    10,
  );
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    5,
    5,
    false,
    OrderType.Limit,
    0,
  );

  await market.reload(connection);
  market.prettyPrint();

  const fillFeed: FillFeed = new FillFeed(connection);
  await Promise.all([
    fillFeed.parseLogs(true),
    checkForFillMessage(connection, payerKeypair, marketAddress),
  ]);
}

async function checkForFillMessage(
  connection: Connection,
  payerKeypair: Keypair,
  marketAddress: PublicKey,
) {
  const ws = new WebSocket('ws://localhost:1234');

  ws.on('open', () => {
    console.log('Connected to server');
  });

  let gotFillMessage: boolean = false;
  ws.on('message', (message: string) => {
    console.log(`Received message from server: ${message}`);
    gotFillMessage = true;
  });

  // Wait for fill feed to connect.
  await new Promise((f) => setTimeout(f, 1_000));

  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    5_000,
    5,
    true,
    OrderType.Limit,
    0,
  );

  // Wait for the fill log
  await new Promise((f) => setTimeout(f, 20_000));
  assert(gotFillMessage, 'Fill feed message');
  ws.close();
}

describe('FillListener test', () => {
  it('FillListener', async () => {
    await testFillFeed();
  });
});
