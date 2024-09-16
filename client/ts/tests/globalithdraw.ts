import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { createGlobal } from './createGlobal';
import { depositGlobal } from './globalDeposit';
import { Global } from '../src/global';
import { assert } from 'chai';

async function testGlobalWithdraw(): Promise<void> {
  const connection: Connection = new Connection('http://127.0.0.1:8899');
  const payerKeypair: Keypair = Keypair.generate();

  const globalAddress: PublicKey = await createGlobal(connection, payerKeypair);
  const global: Global = await Global.loadFromAddress({
    connection,
    address: globalAddress,
  });

  await depositGlobal(connection, payerKeypair, global.tokenMint(), 10);
  await withdrawGlobal(connection, payerKeypair, global.tokenMint(), 5);

  await global.reload(connection);
  assert(
    await (global.getGlobalBalanceTokens(connection, payerKeypair.publicKey)) == 5,
    'global withdraw balance check base',
  );
  global.prettyPrint();
}

export async function withdrawGlobal(
  connection: Connection,
  payerKeypair: Keypair,
  mint: PublicKey,
  amountTokens: number,
): Promise<void> {
  const globalwithdrawIx = await ManifestClient.globalWithdrawIx(
    connection,
    payerKeypair.publicKey,
    mint,
    amountTokens,
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(globalwithdrawIx),
    [payerKeypair],
    {
      commitment: 'confirmed',
    },
  );
  console.log(`Global Withdrew ${amountTokens} tokens in ${signature}`);
}

describe('Global Withdraw test', () => {
  it('Global Withdraw', async () => {
    await testGlobalWithdraw();
  });
});
