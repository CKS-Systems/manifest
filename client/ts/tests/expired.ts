import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { OrderType } from '../src/manifest/types';
import { createMarket } from './createMarket';
import { deposit } from './deposit';
import { Market } from '../src/market';
import { assert } from 'chai';
import { placeOrder } from './placeOrder';

async function testExpiredAsk(): Promise<void> {
  const connection: Connection = new Connection(
    'http://127.0.0.1:8899',
    'confirmed',
  );
  const payerKeypair: Keypair = Keypair.generate();

  const marketAddress: PublicKey = await createMarket(connection, payerKeypair);
  const market: Market = await Market.loadFromAddress({
    connection,
    address: marketAddress,
  });

  await deposit(connection, payerKeypair, marketAddress, market.baseMint(), 10);
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    5,
    5,
    false,
    OrderType.Limit,
    0,
    (await connection.getSlot()) + 20,
  );

  await market.reload(connection);
  market.prettyPrint();

  assert(market.asks().length == 1, 'place ask did not work');

  // 20 slots should pass in 20 seconds.
  await new Promise((f) => setTimeout(f, 20_000));
  await market.reload(connection);
  market.prettyPrint();
  assert(market.asks().length == 0, 'order still there when should be expired');
}

async function testExpiredBid(): Promise<void> {
  const connection: Connection = new Connection(
    'http://127.0.0.1:8899',
    'confirmed',
  );
  const payerKeypair: Keypair = Keypair.generate();

  const marketAddress: PublicKey = await createMarket(connection, payerKeypair);
  const market: Market = await Market.loadFromAddress({
    connection,
    address: marketAddress,
  });

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
    1,
    1,
    true,
    OrderType.Limit,
    0,
    (await connection.getSlot()) + 20,
  );

  await market.reload(connection);
  market.prettyPrint();

  assert(market.bids().length == 1, 'place ask did not work');

  // 20 slots should pass in 20 seconds.
  await new Promise((f) => setTimeout(f, 20_000));
  await market.reload(connection);
  market.prettyPrint();
  assert(market.bids().length == 0, 'order still there when should be expired');
}

describe('Expired Order test', () => {
  it('Expired Ask', async () => {
    await testExpiredAsk();
  });
  it('Expired Bid', async () => {
    await testExpiredBid();
  });
});
