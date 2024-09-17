import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import {
  mintTo,
  createAssociatedTokenAccountIdempotent,
  getMint,
} from '@solana/spl-token';
import { createGlobal } from './createGlobal';
import { Global } from '../src/global';
import { assert } from 'chai';

async function testGlobalDeposit(): Promise<void> {
  const connection: Connection = new Connection('http://127.0.0.1:8899');
  const payerKeypair: Keypair = Keypair.generate();

  const globalAddress: PublicKey = await createGlobal(connection, payerKeypair);
  const global: Global = await Global.loadFromAddress({
    connection,
    address: globalAddress,
  });

  await depositGlobal(connection, payerKeypair, global.tokenMint(), 10);

  await global.reload(connection);
  assert(
    (await global.getGlobalBalanceTokens(connection, payerKeypair.publicKey)) ==
      10,
    'deposit global balance check',
  );
  global.prettyPrint();
}

export async function depositGlobal(
  connection: Connection,
  payerKeypair: Keypair,
  mint: PublicKey,
  amountTokens: number,
): Promise<void> {
  const globalAddTraderIx = ManifestClient.createGlobalAddTraderIx(
    payerKeypair.publicKey,
    mint,
  );

  const globalDepositIx = await ManifestClient.globalDepositIx(
    connection,
    payerKeypair.publicKey,
    mint,
    amountTokens,
  );

  const traderTokenAccount = await createAssociatedTokenAccountIdempotent(
    connection,
    payerKeypair,
    mint,
    payerKeypair.publicKey,
  );

  const mintDecimals = (await getMint(connection, mint)).decimals;
  const amountAtoms = Math.ceil(amountTokens * 10 ** mintDecimals);
  const mintSig = await mintTo(
    connection,
    payerKeypair,
    mint,
    traderTokenAccount,
    payerKeypair.publicKey,
    amountAtoms,
  );
  console.log(
    `Minted ${amountTokens} tokens to ${traderTokenAccount} in ${mintSig}`,
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(globalAddTraderIx, globalDepositIx),
    [payerKeypair],
    {
      commitment: 'confirmed',
    },
  );
  console.log(
    `Global Add Trader & Deposited ${amountTokens} tokens in ${signature}`,
  );
}

describe('Global Deposit test', () => {
  it('Global Deposit', async () => {
    await testGlobalDeposit();
  });
});
