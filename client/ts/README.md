# Manifest SDK

Typescript library for interacting with Manifest

## Installation

Install via npm:

```sh
# add via npm
yarn add @cks-systems/manifest-sdk
```

## Usage

```ts
import { ManifestClient, OrderType } from '@cks-systems/manifest-sdk';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

export const sleep = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const run = async () => {
  // FIXME: replace with valid rpcUrl
  const conn = new Connection('FIXME');
  // FIXME: replace with own `Keypair`
  const user = Keypair.generate();
  // FIXME: replace with a valid market
  const marketPub = new PublicKey('FIXME');

  // FIXME: set an appropriate priority fee
  const prioFee = 10_000;

  const prioIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: prioFee,
  });

  // NOTE: this will automatically attempt to send a tx to claim a seat if needed.
  // use `ManifestClient.getClientForMarketNoPrivateKey` if you do not want this behavior
  const mfx = await ManifestClient.getClientForMarket(
    conn as any,
    marketPub,
    user as any,
  );

  const baseMint = mfx.market.baseMint();
  const quoteMint = mfx.market.quoteMint();

  const baseAta = getAssociatedTokenAddressSync(baseMint, user.publicKey);
  const quoteAta = getAssociatedTokenAddressSync(quoteMint, user.publicKey);

  const [
    {
      value: { uiAmount: baseBalTokens },
    },
    {
      value: { uiAmount: quoteBalTokens },
    },
  ] = await Promise.all([
    conn.getTokenAccountBalance(baseAta),
    conn.getTokenAccountBalance(quoteAta),
  ]);
  console.log('baseBalTokens', baseBalTokens);
  console.log('quoteBalTokens', quoteBalTokens);

  if ((baseBalTokens || 0) < 1) {
    throw new Error(
      `base balance is too low. top up and try again. got: ${baseBalTokens} want: 1`,
    );
  }

  const bidParams = {
    numBaseTokens: 1,
    tokenPrice: 0.9,
    isBid: true,
    lastValidSlot: 0,
    orderType: OrderType.PostOnly,
    clientOrderId: 0,
    minOutTokens: 0,
  };

  console.log('submitting bid limit order...');
  const bidCuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 });
  const quoteDepositIx = mfx.depositIx(user.publicKey, quoteMint, 0.9);
  const bidIx = mfx.placeOrderIx(bidParams);

  const bidTx = new Transaction().add(prioIx, bidCuIx, quoteDepositIx, bidIx);
  const bidSig = await sendAndConfirmTransaction(conn, bidTx, [user]);
  console.log(`limit bid submitted: txSig: ${bidSig}`);

  const askParams = {
    numBaseTokens: 1,
    tokenPrice: 1.1,
    isBid: false,
    lastValidSlot: 0,
    orderType: OrderType.PostOnly,
    clientOrderId: 0,
    minOutTokens: 0,
  };

  console.log('submitting ask limit order...');
  const askCuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 });
  const baseDepositIx = mfx.depositIx(user.publicKey, baseMint, 1);
  const askIx = mfx.placeOrderIx(askParams);

  const askTx = new Transaction().add(prioIx, askCuIx, baseDepositIx, askIx);
  const askSig = await sendAndConfirmTransaction(conn, askTx, [user]);
  console.log(`limit ask submitted: txSig: ${askSig}`);

  // make sure on-chain state updates
  await sleep(5_000);
  await mfx.reload();

  const openOrders = mfx.wrapper.openOrdersForMarket(marketPub);
  const marketInfo = mfx.wrapper.marketInfoForMarket(marketPub);

  console.log('market:');
  console.log(mfx.market.prettyPrint());

  console.log('wrapper:');
  console.log(mfx.wrapper.prettyPrint());

  console.log('openOrders:');
  console.log(openOrders);

  console.log('marketInfo:');
  console.log(marketInfo);

  console.log('bids', mfx.market.bids());
  console.log('asks', mfx.market.asks());

  console.log('cancelling all orders and withdrawing funds...');
  const cancelCuIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 80_000,
  });
  const cancelAllIx = mfx.cancelAllIx();
  const withdrawIxs = mfx.withdrawAllIx();
  const cancelAllTx = new Transaction().add(
    prioIx,
    cancelCuIx,
    cancelAllIx,
    ...withdrawIxs,
  );
  const cancelSig = await sendAndConfirmTransaction(conn, cancelAllTx, [user]);
  console.log(`cancelled/withdrawn: ${cancelSig}`);
};

run().catch(console.error);
```
