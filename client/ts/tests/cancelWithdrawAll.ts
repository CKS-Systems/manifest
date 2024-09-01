import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { createMarket } from './createMarket';
import { deposit } from './deposit';
import { Market } from '../src/market';
import { assert } from 'chai';
import { placeOrder } from './placeOrder';
import { OrderType } from '../src/manifest/types';

async function testCancelWithdrawAll(): Promise<void> {
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
    3,
    3,
    true,
    OrderType.Limit,
    1,
  );

  await market.reload(connection);
  await cancelAndwithdrawAll(connection, payerKeypair, marketAddress);
  await market.reload(connection);

  assert(
    market.openOrders().length == 0,
    `cancel did not cancel all orders ${market.openOrders().length}`,
  );
  assert(
    market.getWithdrawableBalanceTokens(payerKeypair.publicKey, true) == 0,
    'withdraw withdrawable balance check base',
  );
  assert(
    market.getWithdrawableBalanceTokens(payerKeypair.publicKey, false) == 0,
    'withdraw withdrawable balance check quote',
  );
  market.prettyPrint();
}

// Note this also tests cancelAll and WithdrawAll since this is just a combination of them
export async function cancelAndwithdrawAll(
  connection: Connection,
  payerKeypair: Keypair,
  marketAddress: PublicKey,
): Promise<void> {
  const client: ManifestClient = await ManifestClient.getClientForMarket(
    connection,
    marketAddress,
    payerKeypair,
  );
  const cancelWithdrawIx = client.cancelAllAndWithdrawAllIx(
    payerKeypair.publicKey,
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(...cancelWithdrawIx),
    [payerKeypair],
    {
      commitment: 'confirmed',
    },
  );
  console.log(`Canceled and Withdrew tokens in ${signature}`);
}

describe('Cancel Withdraw All test', () => {
  it('CancelWithdrawAll', async () => {
    await testCancelWithdrawAll();
  });
});
