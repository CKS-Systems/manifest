import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { Global } from '../src/global';
import { airdropSol, getClusterFromConnection } from '../src/utils/solana';
import { createMint } from '@solana/spl-token';
import { getGlobalAddress } from '../src/utils/global';

async function testCreateGlobal(): Promise<void> {
  const connection: Connection = new Connection('http://127.0.0.1:8899');
  const payerKeypair: Keypair = Keypair.generate();
  // Get SOL for rent.
  console.log('Airdropping sol');
  await airdropSol(connection, payerKeypair.publicKey);

  await new Promise((f) => setTimeout(f, 1_000));
  console.log('Creating mint');
  const tokenMint: PublicKey = await createMint(
    connection,
    payerKeypair,
    payerKeypair.publicKey,
    payerKeypair.publicKey,
    9,
  );
  console.log(
    `Created tokenMint ${tokenMint}, global will be at ${getGlobalAddress(tokenMint)}`,
  );
  await new Promise((f) => setTimeout(f, 1_000));
  console.log('Creating global');
  await createGlobal(connection, payerKeypair, tokenMint);
  await new Promise((f) => setTimeout(f, 1_000));

  const global: Global = await Global.loadFromAddress({
    connection,
    address: getGlobalAddress(tokenMint),
  });
  global.prettyPrint();
}

export async function createGlobal(
  connection: Connection,
  payerKeypair: Keypair,
  tokenMint: PublicKey,
): Promise<void> {
  console.log(`Cluster is ${await getClusterFromConnection(connection)}`);

  const createGlobalIx = await ManifestClient['createGlobalCreateIx'](
    connection,
    payerKeypair.publicKey,
    tokenMint,
  );

  const tx: Transaction = new Transaction();
  tx.add(createGlobalIx);
  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [payerKeypair],
    {
      skipPreflight: true,
      commitment: 'finalized',
    },
  );
  console.log(`Created global for ${tokenMint} in ${signature}`);
}

describe('Create Global test', () => {
  it('Create Global', async () => {
    await testCreateGlobal();
  });
});
