import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { createMarket } from './createMarket';
import { Market } from '../src/market';
import {
  createAssociatedTokenAccountIdempotent,
  getAssociatedTokenAddress,
  mintTo,
} from '@solana/spl-token';
import { assert } from 'chai';
import { placeOrder } from './placeOrder';
import { airdropSol } from '../src/utils/solana';
import { depositGlobal } from './globalDeposit';
import { createGlobal } from './createGlobal';
import { OrderType } from '../src';
import { NO_EXPIRATION_LAST_VALID_SLOT } from '../src/constants';

async function testSwap(): Promise<void> {
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

  const traderTokenAccount = await createAssociatedTokenAccountIdempotent(
    connection,
    payerKeypair,
    market.baseMint(),
    payerKeypair.publicKey,
  );
  // Initialize so trader can receive.
  await createAssociatedTokenAccountIdempotent(
    connection,
    payerKeypair,
    market.quoteMint(),
    payerKeypair.publicKey,
  );

  const amountAtoms: number = 1_000_000_000;
  const mintSig = await mintTo(
    connection,
    payerKeypair,
    market.baseMint(),
    traderTokenAccount,
    payerKeypair.publicKey,
    amountAtoms,
  );
  console.log(`Minted ${amountAtoms} to ${traderTokenAccount} in ${mintSig}`);

  await swap(connection, payerKeypair, marketAddress, amountAtoms / 10, false);

  await market.reload(connection);
  market.prettyPrint();

  // Asks are sorted worst to best.
  assert(market.openOrders().length == 0, 'Swap does not rest order');
}

export async function swap(
  connection: Connection,
  payerKeypair: Keypair,
  marketAddress: PublicKey,
  amountAtoms: number,
  isBid: boolean,
  minOutAtoms: number = 0,
): Promise<void> {
  const client: ManifestClient = await ManifestClient.getClientForMarket(
    connection,
    marketAddress,
    payerKeypair,
  );

  const swapIx: TransactionInstruction = client.swapIx(payerKeypair.publicKey, {
    inAtoms: amountAtoms,
    outAtoms: minOutAtoms,
    isBaseIn: isBid,
    isExactIn: true,
  });

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(swapIx),
    [payerKeypair],
  );
  console.log(`Placed order in ${signature}`);
}

async function _testSwapGlobal(): Promise<void> {
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

  const traderBaseTokenAccount: PublicKey =
    await createAssociatedTokenAccountIdempotent(
      connection,
      payerKeypair,
      market.baseMint(),
      payerKeypair.publicKey,
    );
  // Initialize trader quote so they can receive.
  await createAssociatedTokenAccountIdempotent(
    connection,
    payerKeypair,
    market.quoteMint(),
    payerKeypair.publicKey,
  );

  const amountBaseAtoms: number = 1_000_000_000;
  const mintSig = await mintTo(
    connection,
    payerKeypair,
    market.baseMint(),
    traderBaseTokenAccount,
    payerKeypair.publicKey,
    amountBaseAtoms,
  );
  console.log(
    `Minted ${amountBaseAtoms} to ${traderBaseTokenAccount} in ${mintSig}`,
  );

  // Note that this is a self-trade for simplicity.
  await airdropSol(connection, payerKeypair.publicKey);
  await createGlobal(connection, payerKeypair, market.quoteMint());
  await depositGlobal(connection, payerKeypair, market.quoteMint(), 10_000);
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    5,
    5,
    true,
    OrderType.Global,
    1,
    NO_EXPIRATION_LAST_VALID_SLOT,
  );

  await swap(connection, payerKeypair, marketAddress, amountBaseAtoms, false);
  await market.reload(connection);
  market.prettyPrint();

  // Verify that the resting order got matched and resulted in deposited base on
  // the market. Quote came from global and got withdrawn in the swap. Because
  // it is a self-trade, it resets to zero, so we need to check the wallet.
  assert(
    market.getWithdrawableBalanceTokens(payerKeypair.publicKey, false) == 0,
    `Expected quote ${0} actual quote ${market.getWithdrawableBalanceTokens(payerKeypair.publicKey, false)}`,
  );
  assert(
    market.getWithdrawableBalanceTokens(payerKeypair.publicKey, true) == 0,
    `Expected base ${0} actual base ${market.getWithdrawableBalanceTokens(payerKeypair.publicKey, true)}`,
  );
  const baseBalance: number = (
    await connection.getTokenAccountBalance(
      await getAssociatedTokenAddress(
        market.baseMint(),
        payerKeypair.publicKey,
      ),
    )
  ).value.uiAmount!;
  const quoteBalance: number = (
    await connection.getTokenAccountBalance(
      await getAssociatedTokenAddress(
        market.quoteMint(),
        payerKeypair.publicKey,
      ),
    )
  ).value.uiAmount!;
  // Because of the self trade, it resets the wallet to pre-trade amount.
  assert(
    baseBalance == 1,
    `Expected wallet base ${1} actual base ${baseBalance}`,
  );
  // 5 * 5, received from matching the global order.
  assert(
    quoteBalance == 25,
    `Expected  quote ${25} actual quote ${quoteBalance}`,
  );
}

describe('Swap test', () => {
  it('Swap', async () => {
    await testSwap();
  });
  it('Swap against global', async () => {
    // TODO: Enable once able to place global order through batch update
    // await testSwapGlobal();
  });
});
