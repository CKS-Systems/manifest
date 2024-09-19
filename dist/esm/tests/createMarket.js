import { Connection, Keypair, sendAndConfirmTransaction, SystemProgram, Transaction, } from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { PROGRAM_ID } from '../src/manifest';
import { Market } from '../src/market';
import { airdropSol, getClusterFromConnection } from '../src/utils/solana';
import { createMint } from '@solana/spl-token';
import { FIXED_MANIFEST_HEADER_SIZE } from '../src/constants';
async function testCreateMarket() {
    const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    const payerKeypair = Keypair.generate();
    const marketAddress = await createMarket(connection, payerKeypair);
    const market = await Market.loadFromAddress({
        connection,
        address: marketAddress,
    });
    market.prettyPrint();
}
export async function createMarket(connection, payerKeypair) {
    const marketKeypair = Keypair.generate();
    console.log(`Cluster is ${await getClusterFromConnection(connection)}`);
    // Get SOL for rent and make airdrop states.
    await airdropSol(connection, payerKeypair.publicKey);
    const baseMint = await createMint(connection, payerKeypair, payerKeypair.publicKey, payerKeypair.publicKey, 9);
    const quoteMint = await createMint(connection, payerKeypair, payerKeypair.publicKey, payerKeypair.publicKey, 6);
    console.log(`Created baseMint ${baseMint} quoteMint ${quoteMint}`);
    const createAccountIx = SystemProgram.createAccount({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: marketKeypair.publicKey,
        space: FIXED_MANIFEST_HEADER_SIZE,
        lamports: await connection.getMinimumBalanceForRentExemption(FIXED_MANIFEST_HEADER_SIZE),
        programId: PROGRAM_ID,
    });
    const createMarketIx = ManifestClient['createMarketIx'](payerKeypair.publicKey, baseMint, quoteMint, marketKeypair.publicKey);
    const tx = new Transaction();
    tx.add(createAccountIx);
    tx.add(createMarketIx);
    const signature = await sendAndConfirmTransaction(connection, tx, [
        payerKeypair,
        marketKeypair,
    ]);
    console.log(`Created market at ${marketKeypair.publicKey} in ${signature}`);
    return marketKeypair.publicKey;
}
describe('Create Market test', () => {
    it('Create Market', async () => {
        await testCreateMarket();
    });
});
