import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Market } from '../src/market';
import { createMarket } from './createMarket';
import { assert } from 'chai';
import { placeOrder } from './placeOrder';
import { OrderType } from '../src/manifest';
import { deposit } from './deposit';
import {
  createCreateWrapperInstruction,
  createClaimSeatInstruction,
  PROGRAM_ID as WRAPPER_PROGRAM_ID,
} from '../src/wrapper';
import { Wrapper } from '../src/wrapperObj';
import { FIXED_WRAPPER_HEADER_SIZE } from '../src/constants';
import { airdropSol } from '../src/utils/solana';
import { PROGRAM_ID as MANIFEST_PROGRAM_ID } from '../src/manifest';

// Import UI wrapper from old SDK version
import {
  createCreateWrapperInstruction as createCreateUIWrapperInstruction,
  createClaimSeatUnusedInstruction as createClaimSeatUIInstruction,
  PROGRAM_ID as UI_WRAPPER_PROGRAM_ID,
} from '@cks-systems/manifest-sdk-old/dist/types/src/ui_wrapper';
import { UiWrapper } from '@cks-systems/manifest-sdk-old/dist/types/src/uiWrapperObj';

async function testMixedWrappers(): Promise<void> {
  const connection: Connection = new Connection(
    'http://127.0.0.1:8899',
    'confirmed',
  );
  const payerKeypair: Keypair = Keypair.generate();
  const marketAddress: PublicKey = await createMarket(connection, payerKeypair);

  const market: Market = await Market.loadFromAddress({
    connection,
    address: marketAddress,
  });
  console.log('Created market:', marketAddress.toBase58());
  market.prettyPrint();

  // Step 1: Create a UI wrapper using the old SDK
  console.log('\n=== Step 1: Creating UI wrapper and claiming seat ===');

  const uiWrapperKeypair: Keypair = Keypair.generate();
  await airdropSol(connection, payerKeypair.publicKey);

  const createUIWrapperAccountIx: TransactionInstruction =
    SystemProgram.createAccount({
      fromPubkey: payerKeypair.publicKey,
      newAccountPubkey: uiWrapperKeypair.publicKey,
      space: FIXED_WRAPPER_HEADER_SIZE,
      lamports: await connection.getMinimumBalanceForRentExemption(
        FIXED_WRAPPER_HEADER_SIZE,
      ),
      programId: UI_WRAPPER_PROGRAM_ID,
    });

  const createUIWrapperIx: TransactionInstruction =
    createCreateUIWrapperInstruction({
      owner: payerKeypair.publicKey,
      payer: payerKeypair.publicKey,
      wrapperState: uiWrapperKeypair.publicKey,
    });

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createUIWrapperAccountIx).add(createUIWrapperIx),
    [payerKeypair, uiWrapperKeypair],
  );

  console.log('UI Wrapper created at:', uiWrapperKeypair.publicKey.toBase58());

  // Load the UI wrapper
  const uiWrapperAccountInfo = await connection.getAccountInfo(
    uiWrapperKeypair.publicKey,
  );
  if (!uiWrapperAccountInfo) {
    throw new Error('UI wrapper account not found');
  }
  const uiWrapper = UiWrapper.loadFromBuffer({
    address: uiWrapperKeypair.publicKey,
    buffer: uiWrapperAccountInfo.data,
  });

  // Claim seat on market using UI wrapper
  const systemProgram: PublicKey = SystemProgram.programId;
  const manifestProgram: PublicKey = MANIFEST_PROGRAM_ID;
  const owner: PublicKey = payerKeypair.publicKey;

  const claimSeatIx = createClaimSeatUIInstruction({
    wrapperState: uiWrapperKeypair.publicKey,
    owner: owner,
    payer: payerKeypair.publicKey,
    market: marketAddress,
    systemProgram: systemProgram,
    manifestProgram: manifestProgram,
  });

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(claimSeatIx),
    [payerKeypair],
  );

  console.log('Claimed seat on market using UI wrapper');

  // Deposit and place an order using UI wrapper
  await deposit(
    connection,
    payerKeypair,
    marketAddress,
    market.baseMint(),
    100,
  );
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    10,
    5,
    false,
    OrderType.Limit,
    0,
  );

  console.log('Successfully placed order using UI wrapper');

  // Reload wrapper to see the order
  await uiWrapper.reload(connection);
  const uiWrapperMarketInfo = uiWrapper.marketInfoForMarket(marketAddress);
  assert(
    uiWrapperMarketInfo != null,
    'Expected to find market info for UI wrapper',
  );
  assert(
    uiWrapperMarketInfo!.orders.length === 1,
    'Expected 1 order from UI wrapper',
  );

  console.log('\n=== Step 2: Creating normal wrapper with same wallet ===');

  // Step 2: Now create a normal wrapper with the same wallet
  const normalWrapperKeypair: Keypair = Keypair.generate();

  const createNormalWrapperAccountIx: TransactionInstruction =
    SystemProgram.createAccount({
      fromPubkey: payerKeypair.publicKey,
      newAccountPubkey: normalWrapperKeypair.publicKey,
      space: FIXED_WRAPPER_HEADER_SIZE,
      lamports: await connection.getMinimumBalanceForRentExemption(
        FIXED_WRAPPER_HEADER_SIZE,
      ),
      programId: WRAPPER_PROGRAM_ID,
    });

  const createNormalWrapperIx: TransactionInstruction =
    createCreateWrapperInstruction({
      owner: payerKeypair.publicKey,
      wrapperState: normalWrapperKeypair.publicKey,
    });

  await sendAndConfirmTransaction(
    connection,
    new Transaction()
      .add(createNormalWrapperAccountIx)
      .add(createNormalWrapperIx),
    [payerKeypair, normalWrapperKeypair],
  );

  console.log(
    'Normal Wrapper created at:',
    normalWrapperKeypair.publicKey.toBase58(),
  );

  // Load the normal wrapper
  const normalWrapper = await Wrapper.loadFromAddress({
    connection,
    address: normalWrapperKeypair.publicKey,
  });

  // Try to claim seat on the same market using normal wrapper
  const claimSeatNormalIx = createClaimSeatInstruction({
    wrapperState: normalWrapperKeypair.publicKey,
    owner: owner,
    market: marketAddress,
    systemProgram: systemProgram,
    manifestProgram: manifestProgram,
  });

  try {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(claimSeatNormalIx),
      [payerKeypair],
    );
    console.log('Successfully claimed seat on market using normal wrapper');
  } catch (error) {
    console.log(
      'Failed to claim seat with normal wrapper (expected if seat already claimed):',
      error,
    );
  }

  // Place another order using normal wrapper
  await placeOrder(
    connection,
    payerKeypair,
    marketAddress,
    15,
    6,
    false,
    OrderType.Limit,
    0,
  );

  console.log('Successfully placed order using normal wrapper');

  // Reload both wrappers to see all orders
  await normalWrapper.reload(connection);
  await uiWrapper.reload(connection);

  const normalWrapperOrders = normalWrapper.openOrdersForMarket(marketAddress);
  await uiWrapper.reload(connection);
  const uiWrapperMarketInfoFinal = uiWrapper.marketInfoForMarket(marketAddress);

  // Verify results
  console.log('\n=== Test Results ===');
  console.log(
    'UI Wrapper orders:',
    uiWrapperMarketInfoFinal?.orders.length || 0,
  );
  console.log('Normal Wrapper orders:', normalWrapperOrders?.length || 0);

  // The test demonstrates that the same wallet can use both UI wrapper and normal wrapper
  assert(
    uiWrapperMarketInfoFinal != null &&
      uiWrapperMarketInfoFinal.orders.length >= 1,
    'Expected UI wrapper to have at least 1 order',
  );

  assert(
    normalWrapperOrders != null && normalWrapperOrders.length >= 1,
    'Expected normal wrapper to have at least 1 order',
  );

  console.log(
    '\n✅ Test passed: Same wallet successfully used both UI wrapper and normal wrapper',
  );

  // Pretty print both wrappers
  console.log('\n--- UI Wrapper State ---');
  uiWrapper.prettyPrint();

  console.log('\n--- Normal Wrapper State ---');
  normalWrapper.prettyPrint();
}

describe('Mixed Wrappers test', () => {
  it('Should allow same wallet to use both UI wrapper and normal wrapper', async () => {
    await testMixedWrappers();
  });
});
