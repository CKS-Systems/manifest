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

async function testBatchUpdate(): Promise<void> {
  const connection: Connection = new Connection('http://127.0.0.1:8899');
  const payerKeypair: Keypair = Keypair.generate();

  const marketAddress: PublicKey = await createMarket(connection, payerKeypair);
  const market: Market = await Market.loadFromAddress({
    connection,
    address: marketAddress,
  });

  await deposit(connection, payerKeypair, marketAddress, market.baseMint(), 10);
  await batchUpdate(
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

  // Asks are sorted worst to best.
  assert(market.asks().length == 1, 'batch update did not work');
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

async function batchUpdate(
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

  const placeOrderIx = client.batchUpdateIx(
    [
      {
        numBaseTokens,
        tokenPrice,
        isBid,
        lastValidSlot: lastValidSlot,
        orderType: orderType,
        minOutTokens,
        clientOrderId,
      },
    ],
    [],
    false,
  );

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

describe('Batch update test', () => {
  it('BatchUpdate', async () => {
    await testBatchUpdate();
  });
});
