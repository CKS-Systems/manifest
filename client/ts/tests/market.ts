import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Market } from '../src/market';
import { createMarket } from './createMarket';
import { ManifestClient } from '../src';
import { assert } from 'chai';
import { placeOrder } from './placeOrder';
import { OrderType } from '../src/manifest';
import { deposit } from './deposit';

async function testMarket(): Promise<void> {
  const connection: Connection = new Connection('http://127.0.0.1:8899');
  const payerKeypair: Keypair = Keypair.generate();
  const marketAddress: PublicKey = await createMarket(connection, payerKeypair);

  // Test loading successfully.
  const market: Market = await Market.loadFromAddress({
    connection,
    address: marketAddress,
  });
  market.prettyPrint();

  // Test loading fails on bad address
  try {
    await Market.loadFromAddress({
      connection,
      address: Keypair.generate().publicKey,
    });
    assert(false, 'expected load from address fail');
  } catch (err) {
    assert(true, 'expected load from address fail');
  }

  // Test reloading successful.
  await market.reload(connection);

  // Test reloading fail.
  try {
    await market.reload(new Connection('https://api.devnet.solana.com'));
    assert(false, 'expected reload fail');
  } catch (err) {
    assert(true, 'expected reload fail');
  }

  // Market withdrawable balance not init
  assert(
    market.getWithdrawableBalanceTokens(payerKeypair.publicKey, true) == 0,
    'Get withdrawable balance with no seat',
  );

  // Init seat.
  await ManifestClient.getClientForMarket(
    connection,
    marketAddress,
    payerKeypair,
  );

  // Place an order to get more coverage on the pretty print.
  await deposit(
    connection,
    payerKeypair,
    marketAddress,
    market.quoteMint(),
    10,
  );
  // Market withdrawable balance after deposit
  assert(
    market.getWithdrawableBalanceTokens(payerKeypair.publicKey, false) == 0,
    'Get withdrawable balance after deposit',
  );

  assert(market.baseDecimals() == 9, 'base decimals');
  assert(market.quoteDecimals() == 6, 'quote decimals');

  // Put orders on both sides to test pretty printing.
  await deposit(connection, payerKeypair, marketAddress, market.baseMint(), 10);
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    1,
    5,
    false,
    OrderType.Limit,
    0,
  );
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    1,
    5,
    true,
    OrderType.Limit,
    0,
  );

  market.prettyPrint();
}

describe('Market test', () => {
  it('Market', async () => {
    //await testMarket();
  });
});
