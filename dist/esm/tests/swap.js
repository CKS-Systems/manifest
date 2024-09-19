import { Connection, Keypair, sendAndConfirmTransaction, Transaction, } from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { createMarket } from './createMarket';
import { Market } from '../src/market';
import { createAssociatedTokenAccountIdempotent, mintTo, } from '@solana/spl-token';
import { assert } from 'chai';
async function testSwap() {
    const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    const payerKeypair = Keypair.generate();
    const marketAddress = await createMarket(connection, payerKeypair);
    const market = await Market.loadFromAddress({
        connection,
        address: marketAddress,
    });
    const traderTokenAccount = await createAssociatedTokenAccountIdempotent(connection, payerKeypair, market.baseMint(), payerKeypair.publicKey);
    // Initialize so trader can receive.
    await createAssociatedTokenAccountIdempotent(connection, payerKeypair, market.quoteMint(), payerKeypair.publicKey);
    const amountAtoms = 1_000_000_000;
    const mintSig = await mintTo(connection, payerKeypair, market.baseMint(), traderTokenAccount, payerKeypair.publicKey, amountAtoms);
    console.log(`Minted ${amountAtoms} to ${traderTokenAccount} in ${mintSig}`);
    await swap(connection, payerKeypair, marketAddress, amountAtoms / 10, false);
    await market.reload(connection);
    market.prettyPrint();
    // Asks are sorted worst to best.
    assert(market.openOrders().length == 0, 'Swap does not rest order');
}
export async function swap(connection, payerKeypair, marketAddress, amountAtoms, isBid, minOutAtoms = 0) {
    const client = await ManifestClient.getClientForMarket(connection, marketAddress, payerKeypair);
    const swapIx = await client.swapIx(payerKeypair.publicKey, {
        inAtoms: amountAtoms,
        outAtoms: minOutAtoms,
        isBaseIn: isBid,
        isExactIn: true,
    });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(swapIx), [payerKeypair]);
    console.log(`Placed order in ${signature}`);
}
describe('Swap test', () => {
    it('Swap', async () => {
        await testSwap();
    });
});
