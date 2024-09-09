import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createMarket } from './createMarket';
import { ManifestClient } from '../src';
import { assert } from 'chai';

async function testGetClientForMarketNoPrivateKey(
  connection: Connection,
  payerKeypair: Keypair,
  marketAddress: PublicKey,
  shouldCrash: boolean,
): Promise<void> {
  let crashed = false;
  try {
    await ManifestClient.getClientForMarketNoPrivateKey(
      connection,
      marketAddress,
      payerKeypair.publicKey,
    );
  } catch (e) {
    crashed = true;
    console.log(e);
  }

  if (shouldCrash) {
    assert(
      crashed,
      'getClientForMarketNoPrivateKey should crash if setup ixs not executed',
    );
  } else {
    assert(
      !crashed,
      'getClientForMarketNoPrivateKey should NOT crash if setup ixs executed',
    );
  }
}

async function testGetSetupIxs(
  connection: Connection,
  payerKeypair: Keypair,
  marketAddress: PublicKey,
  shouldBeNeeded: boolean,
  shouldGiveWrapperKeypair: boolean,
) {
  const { setupNeeded, instructions, wrapperKeypair } =
    await ManifestClient.getSetupIxs(
      connection,
      marketAddress,
      payerKeypair.publicKey,
    );
  assert(
    shouldBeNeeded === setupNeeded,
    `setupNeeded should be ${shouldBeNeeded} but was ${setupNeeded}`,
  );

  if (!setupNeeded) {
    return;
  }

  assert(
    !!wrapperKeypair === shouldGiveWrapperKeypair,
    `wrapperKeypair should be ${shouldGiveWrapperKeypair ? 'not-null' : 'null'}`,
  );

  const signers = [payerKeypair];
  if (wrapperKeypair) {
    signers.push(wrapperKeypair);
  }

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(...instructions),
    signers,
    {
      commitment: 'confirmed',
    },
  );

  console.log(`executed setupIxs: ${signature}`);
}

describe.only('when creating a client using getClientForMarketNoPrivateKey', () => {
  let connection: Connection;
  let payerKeypair: Keypair;
  let marketAddress: PublicKey;

  before(async () => {
    connection = new Connection('http://127.0.0.1:8899');
    payerKeypair = Keypair.generate();
    marketAddress = await createMarket(connection, payerKeypair);
  });

  it('should crash if setupIxs NOT executed', () =>
    testGetClientForMarketNoPrivateKey(
      connection,
      payerKeypair,
      marketAddress,
      true,
    ));

  it('should get setupIxs using getSetupIxs and execute successfully', () =>
    testGetSetupIxs(connection, payerKeypair, marketAddress, true, true));

  it('should wait 5 seconds to let state catch up', () =>
    new Promise((resolve) => setTimeout(resolve, 5_000)));

  it('should NOT crash if setupIxs already executed', () =>
    testGetClientForMarketNoPrivateKey(
      connection,
      payerKeypair,
      marketAddress,
      false,
    ));
});
