import { Connection, Keypair, Transaction, sendAndConfirmTransaction, } from '@solana/web3.js';
import { createMarket } from './createMarket';
import { ManifestClient } from '../src';
import { assert } from 'chai';
async function testGetClientForMarketNoPrivateKey(connection, marketAddress, payerKeypair, shouldCrash) {
    let crashed = false;
    try {
        await ManifestClient.getClientForMarketNoPrivateKey(connection, marketAddress, payerKeypair.publicKey);
    }
    catch (e) {
        crashed = true;
        console.log(e);
    }
    if (shouldCrash) {
        assert(crashed, 'getClientForMarketNoPrivateKey should crash if setup ixs not executed');
    }
    else {
        assert(!crashed, 'getClientForMarketNoPrivateKey should NOT crash if setup ixs executed');
    }
}
async function testGetSetupIxs(connection, marketAddress, payerKeypair, shouldBeNeeded, shouldGiveWrapperKeypair) {
    const { setupNeeded, instructions, wrapperKeypair } = await ManifestClient.getSetupIxs(connection, marketAddress, payerKeypair.publicKey);
    assert(shouldBeNeeded === setupNeeded, `setupNeeded should be ${shouldBeNeeded} but was ${setupNeeded}`);
    if (!setupNeeded) {
        console.log('setupIxs not needed. returning early...');
        return;
    }
    assert(!!wrapperKeypair === shouldGiveWrapperKeypair, `wrapperKeypair should be ${shouldGiveWrapperKeypair ? 'not-null' : 'null'}`);
    const signers = [payerKeypair];
    if (wrapperKeypair) {
        signers.push(wrapperKeypair);
    }
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers);
    console.log(`executed setupIxs: ${signature}`);
}
describe('when creating a client using getClientForMarketNoPrivateKey', () => {
    let connection;
    let payerKeypair;
    let marketAddress;
    before(async () => {
        connection = new Connection('http://127.0.0.1:8899', 'confirmed');
        payerKeypair = Keypair.generate();
        marketAddress = await createMarket(connection, payerKeypair);
    });
    it('should crash if setupIxs NOT executed', async () => {
        await testGetClientForMarketNoPrivateKey(connection, marketAddress, payerKeypair, true);
    });
    it('should get setupIxs using getSetupIxs and execute successfully', async () => {
        await testGetSetupIxs(connection, marketAddress, payerKeypair, true, true);
    });
    it('should wait 15 seconds to let state catch up', async () => {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
    });
    it('should NOT crash if setupIxs already executed', async () => {
        await testGetClientForMarketNoPrivateKey(connection, marketAddress, payerKeypair, false);
    });
});
