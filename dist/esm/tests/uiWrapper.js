import { Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, } from '@solana/web3.js';
import { Market } from '../src/market';
import { createMarket } from './createMarket';
import { assert } from 'chai';
import { FIXED_WRAPPER_HEADER_SIZE } from '../src/constants';
import { PROGRAM_ID as MANIFEST_PROGRAM_ID } from '../src/manifest';
import { PROGRAM_ID, createCreateWrapperInstruction, createClaimSeatInstruction, } from '../src/ui_wrapper';
import { UiWrapper } from '../src/uiWrapperObj';
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync, } from '@solana/spl-token';
async function fetchFirstUserWrapper(connection, payerPub) {
    const existingWrappers = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
            // Dont check discriminant since there is only one type of account.
            {
                memcmp: {
                    offset: 8,
                    encoding: 'base58',
                    bytes: payerPub.toBase58(),
                },
            },
        ],
    });
    return existingWrappers.length > 0 ? existingWrappers[0] : null;
}
async function setupWrapper(connection, market, payer, owner) {
    owner ??= payer;
    const wrapperKeypair = Keypair.generate();
    const createAccountIx = SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: wrapperKeypair.publicKey,
        space: FIXED_WRAPPER_HEADER_SIZE,
        lamports: await connection.getMinimumBalanceForRentExemption(FIXED_WRAPPER_HEADER_SIZE),
        programId: PROGRAM_ID,
    });
    const createWrapperIx = createCreateWrapperInstruction({
        payer,
        owner,
        wrapperState: wrapperKeypair.publicKey,
    });
    const claimSeatIx = createClaimSeatInstruction({
        manifestProgram: MANIFEST_PROGRAM_ID,
        payer,
        owner,
        market,
        wrapperState: wrapperKeypair.publicKey,
    });
    return {
        ixs: [createAccountIx, createWrapperIx, claimSeatIx],
        signers: [wrapperKeypair],
    };
}
async function testWrapper() {
    const startTs = Date.now();
    const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
    const payerKeypair = Keypair.generate();
    const marketAddress = await createMarket(connection, payerKeypair);
    const market = await Market.loadFromAddress({
        connection,
        address: marketAddress,
    });
    market.prettyPrint();
    assert(null == (await fetchFirstUserWrapper(connection, payerKeypair.publicKey)), 'doesnt find a wrapper yet');
    {
        const setup = await setupWrapper(connection, marketAddress, payerKeypair.publicKey, payerKeypair.publicKey);
        const tx = new Transaction();
        tx.add(...setup.ixs);
        const signature = await sendAndConfirmTransaction(connection, tx, [
            payerKeypair,
            ...setup.signers,
        ]);
        console.log(`created ui-wrapper at ${setup.signers[0].publicKey} in ${signature}`);
    }
    const wrapperAcc = await fetchFirstUserWrapper(connection, payerKeypair.publicKey);
    assert(wrapperAcc != null, 'should find wrapper');
    const wrapper = UiWrapper.loadFromBuffer({
        address: wrapperAcc.pubkey,
        buffer: wrapperAcc.account.data,
    });
    assert(wrapper.marketInfoForMarket(marketAddress)?.orders.length == 0, 'no orders yet in market');
    {
        const tx = new Transaction();
        tx.add(createAssociatedTokenAccountIdempotentInstruction(payerKeypair.publicKey, getAssociatedTokenAddressSync(market.baseMint(), payerKeypair.publicKey), payerKeypair.publicKey, market.baseMint()), createMintToInstruction(market.baseMint(), getAssociatedTokenAddressSync(market.baseMint(), payerKeypair.publicKey), payerKeypair.publicKey, 10_000_000_000), wrapper.placeOrderIx(market, {}, {
            isBid: false,
            amount: 10,
            price: 0.02,
        }));
        const signature = await sendAndConfirmTransaction(connection, tx, [
            payerKeypair,
        ]);
        console.log(`placed order in ${signature}`);
    }
    await wrapper.reload(connection);
    // wrapper.prettyPrint();
    const [oo] = wrapper.openOrdersForMarket(marketAddress);
    const amount = oo.numBaseAtoms.toString() / 10 ** market.baseDecimals();
    const price = oo.price * 10 ** (market.quoteDecimals() - market.baseDecimals());
    console.log('Amount:', amount);
    console.log('Price:', price);
    assert(Date.now() > oo.clientOrderId);
    assert(oo.clientOrderId > startTs);
    assert(10 === amount, 'correct amount');
    assert(0.02 === price, 'correct price');
}
describe('UI-wrapper test', () => {
    it('can place, cancel & settle', async () => {
        await testWrapper();
    });
});
