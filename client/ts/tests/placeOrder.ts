import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { OrderType } from '../src/manifest/types';
import { createMarket } from './createMarket';
import { deposit } from './deposit';
import { Market } from '../src/market';
import { assert } from 'chai';

async function testPlaceOrder(): Promise<void> {
  const connection: Connection = new Connection('http://127.0.0.1:8899');
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
    market.baseMint(),
    10_000_000_000,
  );
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    5_000_000_000,
    5,
    false,
    OrderType.Limit,
    0,
  );
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    3_000_000_000,
    3,
    false,
    OrderType.Limit,
    1,
  );

  await market.reload(connection);
  market.prettyPrint();

  // Asks are sorted worst to best.
  assert(market.asks().length == 2, 'place asks did not work');
  assert(
    Number(market.asks()[0].numBaseAtoms) == 5_000_000_000,
    'ask top of book wrong size',
  );
  assert(market.asks()[0].price == 5, 'ask top of book wrong price');
  assert(market.bids().length == 0, 'place bids did not work');
}

export async function placeOrder(
  connection: Connection,
  payerKeypair: Keypair,
  marketAddress: PublicKey,
  baseAtoms: number,
  price: number,
  isBid: boolean,
  orderType: OrderType,
  clientOrderId: number,
  minOutAtoms: number = 0,
  lastValidSlot: number = 0,
): Promise<void> {
  const client: ManifestClient = await ManifestClient.getClientForMarket(
    connection,
    marketAddress,
    payerKeypair,
  );

  const placeOrderIx = client.placeOrderIx({
    baseAtoms,
    price,
    isBid,
    lastValidSlot: lastValidSlot,
    orderType: orderType,
    minOutAtoms,
    clientOrderId,
  });

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(placeOrderIx),
    [payerKeypair],
    {
      commitment: 'confirmed',
    },
  );
  console.log(`Placed order in ${signature}`);
}

describe('Place Order test', () => {
  it('Place Order', async () => {
    await testPlaceOrder();
  });
});
