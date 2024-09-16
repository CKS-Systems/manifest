import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
} from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { PROGRAM_ID } from '../src/manifest';
import { Global } from '../src/global';
import { airdropSol, getClusterFromConnection } from '../src/utils/solana';
import { createMint } from '@solana/spl-token';
import { FIXED_MANIFEST_HEADER_SIZE } from '../src/constants';

async function testCreateGlobal(): Promise<void> {
  const connection: Connection = new Connection('http://127.0.0.1:8899');
  const payerKeypair: Keypair = Keypair.generate();
  const globalAddress: PublicKey = await createGlobal(connection, payerKeypair);

  const global: Global = await Global.loadFromAddress({
    connection,
    address: globalAddress,
  });
  global.prettyPrint();
}

export async function createGlobal(
  connection: Connection,
  payerKeypair: Keypair,
): Promise<PublicKey> {
  const globalKeypair: Keypair = Keypair.generate();
  console.log(`Cluster is ${await getClusterFromConnection(connection)}`);

  // Get SOL for rent and make airdrop states.
  await airdropSol(connection, payerKeypair.publicKey);
  const tokenMint: PublicKey = await createMint(
    connection,
    payerKeypair,
    payerKeypair.publicKey,
    payerKeypair.publicKey,
    9,
  );
  console.log(`Created tokenMint ${tokenMint}`);

  const createAccountIx: TransactionInstruction = SystemProgram.createAccount({
    fromPubkey: payerKeypair.publicKey,
    newAccountPubkey: globalKeypair.publicKey,
    space: FIXED_MANIFEST_HEADER_SIZE,
    lamports: await connection.getMinimumBalanceForRentExemption(
      FIXED_MANIFEST_HEADER_SIZE,
    ),
    programId: PROGRAM_ID,
  });

  const createGlobalIx = ManifestClient['createGlobalIx'](
    connection,
    payerKeypair.publicKey,
    tokenMint,
  );

  const tx: Transaction = new Transaction();
  tx.add(createAccountIx);
  tx.add(createGlobalIx);
  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [payerKeypair, globalKeypair],
    {
      commitment: 'finalized',
    },
  );
  console.log(`Created global at ${globalKeypair.publicKey} in ${signature}`);
  return globalKeypair.publicKey;
}

describe('Create Global test', () => {
  it('Create Global', async () => {
    await testCreateGlobal();
  });
});
