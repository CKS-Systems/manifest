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
  );
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    3,
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
    Number(market.asks()[0].numBaseTokens) == 5,
    'ask top of book wrong size',
  );
  assert(
    market.asks()[0].tokenPrice == 5,
    `ask top of book wrong price ${market.asks()[0].tokenPrice}`,
  );
  assert(market.bids().length == 0, 'place bids did not work');
}

export async function placeOrder(
  connection: Connection,
  payerKeypair: Keypair,
  marketAddress: PublicKey,
  numBaseTokens: number,
  tokenPrice: number,
  isBid: boolean,
  orderType: OrderType,
  clientOrderId: number,
  minOutTokens: number = 0,
  lastValidSlot: number = 0,
): Promise<void> {
  const client: ManifestClient = await ManifestClient.getClientForMarket(
    connection,
    marketAddress,
    payerKeypair,
  );

  const placeOrderIx = client.placeOrderIx({
    numBaseTokens,
    tokenPrice,
    isBid,
    lastValidSlot: lastValidSlot,
    orderType: orderType,
    minOutTokens,
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
    //await testPlaceOrder();
  });
});
