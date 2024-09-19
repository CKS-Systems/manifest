import { Connection, Keypair, sendAndConfirmTransaction, Transaction, } from '@solana/web3.js';
import { ManifestClient } from '../src/client';
import { OrderType } from '../src/manifest/types';
import { createMarket } from './createMarket';
import { deposit } from './deposit';
import { placeOrder } from './placeOrder';
import { Market } from '../src/market';
import { assert } from 'chai';
async function testCancelOrder() {
    const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    const payerKeypair = Keypair.generate();
    const marketAddress = await createMarket(connection, payerKeypair);
    const market = await Market.loadFromAddress({
        connection,
        address: marketAddress,
    });
    await deposit(connection, payerKeypair, marketAddress, market.baseMint(), 10);
    await placeOrder(connection, payerKeypair, marketAddress, 5, 5, false, OrderType.Limit, 0);
    await placeOrder(connection, payerKeypair, marketAddress, 5, 3, false, OrderType.Limit, 1);
    await cancelOrder(connection, payerKeypair, marketAddress, 0);
    await placeOrder(connection, payerKeypair, marketAddress, 5, 3, false, OrderType.Limit, 2);
    await cancelOrder(connection, payerKeypair, marketAddress, 2);
    await placeOrder(connection, payerKeypair, marketAddress, 5, 3, false, OrderType.Limit, 3);
    await cancelOrder(connection, payerKeypair, marketAddress, 1);
    await placeOrder(connection, payerKeypair, marketAddress, 1, 3, false, OrderType.Limit, 4);
    await placeOrder(connection, payerKeypair, marketAddress, 1, 3, false, OrderType.Limit, 5);
    await placeOrder(connection, payerKeypair, marketAddress, 1, 3, false, OrderType.Limit, 6);
    await placeOrder(connection, payerKeypair, marketAddress, 1, 3, false, OrderType.Limit, 7);
    // 1 was already cancelled so wrapper fails silently.
    await cancelOrder(connection, payerKeypair, marketAddress, 1);
    await market.reload(connection);
    assert(market.openOrders().length == 5, 'cancel did not cancel all orders');
    market.prettyPrint();
}
export async function cancelOrder(connection, payerKeypair, marketAddress, clientOrderId) {
    const client = await ManifestClient.getClientForMarket(connection, marketAddress, payerKeypair);
    const cancelOrderIx = client.cancelOrderIx({
        clientOrderId,
    });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(cancelOrderIx), [payerKeypair]);
    console.log(`Canceled order in ${signature}`);
}
describe('Cancel test', () => {
    it('Place and cancel orders', async () => {
        await testCancelOrder();
    });
});
