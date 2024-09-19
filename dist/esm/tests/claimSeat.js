import { Connection, Keypair } from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { createMarket } from './createMarket';
import { Market } from '../src/market';
import { assert } from 'chai';
async function testClaimSeat() {
    const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    const payerKeypair = Keypair.generate();
    const marketAddress = await createMarket(connection, payerKeypair);
    const market = await Market.loadFromAddress({
        connection,
        address: marketAddress,
    });
    market.prettyPrint();
    await claimSeat(connection, marketAddress, payerKeypair);
    const marketUpdated = await Market.loadFromAddress({
        connection,
        address: marketAddress,
    });
    marketUpdated.prettyPrint();
    assert(marketUpdated.hasSeat(payerKeypair.publicKey), 'claim seat did not have the seat claimed');
    // Claiming on a second market. There is a wrapper, but not a claimed seat.
    const marketAddress2 = await createMarket(connection, payerKeypair);
    const market2 = await Market.loadFromAddress({
        connection,
        address: marketAddress2,
    });
    market2.prettyPrint();
    await claimSeat(connection, marketAddress2, payerKeypair);
    const marketUpdated2 = await Market.loadFromAddress({
        connection,
        address: marketAddress2,
    });
    marketUpdated2.prettyPrint();
    assert(marketUpdated2.hasSeat(payerKeypair.publicKey), 'claim seat did not have the seat claimed on second seat');
    // Test loading without needing to initialize on chain.
    await Market.loadFromAddress({
        connection,
        address: marketAddress2,
    });
}
export async function claimSeat(connection, market, payerKeypair) {
    await ManifestClient.getClientForMarket(connection, market, payerKeypair);
}
describe('Claim Seat test', () => {
    it('Claim seat', async () => {
        await testClaimSeat();
    });
});
