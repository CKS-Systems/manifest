import {
  AccountInfo,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Market } from '../src/market';
import { createMarket } from './createMarket';
import { assert } from 'chai';
import { FIXED_WRAPPER_HEADER_SIZE, NO_EXPIRATION_LAST_VALID_SLOT, PRICE_MAX_EXP, PRICE_MIN_EXP, U32_MAX } from '../src/constants';
import { PROGRAM_ID as MANIFEST_PROGRAM_ID } from '../src/manifest';
import {
  PROGRAM_ID,
  createCreateWrapperInstruction,
  createClaimSeatInstruction,
  createPlaceOrderInstruction,
  OrderType,
} from '../src/ui_wrapper';
import { UiWrapper, OpenOrder } from '../src/uiWrapperObj';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { getVaultAddress } from '../src/utils/market';

type WrapperResponse = Readonly<{
  account: AccountInfo<Buffer>;
  pubkey: PublicKey;
}>;

async function fetchFirstUserWrapper(
  connection: Connection,
  payerPub: PublicKey,
): Promise<WrapperResponse | null> {
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

async function setupWrapper(
  connection: Connection,
  market: PublicKey,
  payer: PublicKey,
  owner?: PublicKey,
): Promise<{ ixs: TransactionInstruction[]; signers: Signer[] }> {
  owner ??= payer;
  const wrapperKeypair: Keypair = Keypair.generate();
  const createAccountIx: TransactionInstruction = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: wrapperKeypair.publicKey,
    space: FIXED_WRAPPER_HEADER_SIZE,
    lamports: await connection.getMinimumBalanceForRentExemption(
      FIXED_WRAPPER_HEADER_SIZE,
    ),
    programId: PROGRAM_ID,
  });
  const createWrapperIx: TransactionInstruction =
    createCreateWrapperInstruction({
      payer,
      owner,
      wrapperState: wrapperKeypair.publicKey,
    });
  const claimSeatIx: TransactionInstruction = createClaimSeatInstruction({
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

async function placeOrderCreateWrapperIfNotExists(
  connection: Connection,
  market: Market,
  owner: PublicKey,
  args: { isBid: boolean; amount: number; price: number; orderId?: number }
): Promise<{ ixs: TransactionInstruction[]; signers: Signer[] }> {

  const wrapper = await fetchFirstUserWrapper(connection, owner);
  if (wrapper) {
    const placeIx = UiWrapper.loadFromBuffer({
      address: wrapper.pubkey,
      buffer: wrapper.account.data,
    }).placeOrderIx(market, {}, args);
    return { ixs: [placeIx], signers: [] };
  } else {
    const result = await setupWrapper(connection, market.address, owner);

    const payer = owner;
    const { isBid } = args;
    const mint = isBid ? market.quoteMint() : market.baseMint();
    const traderTokenAccount = getAssociatedTokenAddressSync(mint, owner);
    const vault = getVaultAddress(market.address, mint);
    const clientOrderId = args.orderId ?? Date.now();
    const baseAtoms = Math.round(args.amount * 10 ** market.baseDecimals());
    let priceMantissa = args.price;
    let priceExponent = market.quoteDecimals() - market.baseDecimals();
    while (
      priceMantissa < U32_MAX / 10 &&
      priceExponent > PRICE_MIN_EXP &&
      Math.round(priceMantissa) != priceMantissa
    ) {
      priceMantissa *= 10;
      priceExponent -= 1;
    }
    while (priceMantissa > U32_MAX && priceExponent < PRICE_MAX_EXP) {
      priceMantissa = priceMantissa / 10;
      priceExponent += 1;
    }
    priceMantissa = Math.round(priceMantissa);

    const placeIx = createPlaceOrderInstruction(
      {
        wrapperState: result.signers[0].publicKey,
        owner,
        traderTokenAccount,
        market: market.address,
        vault,
        mint,
        manifestProgram: MANIFEST_PROGRAM_ID,
        payer,
      },
      {
        params: {
          clientOrderId,
          baseAtoms,
          priceMantissa,
          priceExponent,
          isBid,
          lastValidSlot: NO_EXPIRATION_LAST_VALID_SLOT,
          orderType: OrderType.Limit,
        },
      },
    );

    result.ixs.push(placeIx);
    return result;
  }

}

async function testWrapper(): Promise<void> {
  const startTs = Date.now();
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
  market.prettyPrint();

  assert(
    null == (await fetchFirstUserWrapper(connection, payerKeypair.publicKey)),
    'doesnt find a wrapper yet',
  );

  {
    const setup = await setupWrapper(
      connection,
      marketAddress,
      payerKeypair.publicKey,
      payerKeypair.publicKey,
    );
    const tx = new Transaction();
    tx.add(...setup.ixs);
    const signature = await sendAndConfirmTransaction(connection, tx, [
      payerKeypair,
      ...setup.signers,
    ]);
    console.log(
      `created ui-wrapper at ${setup.signers[0].publicKey} in ${signature}`,
    );
  }

  const wrapperAcc = await fetchFirstUserWrapper(
    connection,
    payerKeypair.publicKey,
  );
  assert(wrapperAcc != null, 'should find wrapper');
  const wrapper = UiWrapper.loadFromBuffer({
    address: wrapperAcc.pubkey,
    buffer: wrapperAcc.account.data,
  });
  assert(
    wrapper.marketInfoForMarket(marketAddress)?.orders.length == 0,
    'no orders yet in market',
  );

  {
    const tx = new Transaction();
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payerKeypair.publicKey,
        getAssociatedTokenAddressSync(
          market.baseMint(),
          payerKeypair.publicKey,
        ),
        payerKeypair.publicKey,
        market.baseMint(),
      ),
      createMintToInstruction(
        market.baseMint(),
        getAssociatedTokenAddressSync(
          market.baseMint(),
          payerKeypair.publicKey,
        ),
        payerKeypair.publicKey,
        10_000_000_000,
      ),
      wrapper.placeOrderIx(
        market,
        {},
        {
          isBid: false,
          amount: 10,
          price: 0.02,
        },
      ),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [
      payerKeypair,
    ]);
    console.log(`placed order in ${signature}`);
  }

  await wrapper.reload(connection);
  // wrapper.prettyPrint();

  const [wrapperOrder] = wrapper.openOrdersForMarket(marketAddress) as OpenOrder[];
  const amount =
    (wrapperOrder.numBaseAtoms.toString() as any) / 10 ** market.baseDecimals();
  const price =
    wrapperOrder.price * 10 ** (market.baseDecimals() - market.quoteDecimals());
  console.log('Amount:', amount);
  console.log('Price:', price);
  assert(Date.now() > (wrapperOrder.clientOrderId as number));
  assert((wrapperOrder.clientOrderId as number) > startTs);
  assert(10 === amount, 'correct amount');
  assert(0.02 === price, 'correct price');


  const allMarketPks = wrapper.activeMarkets();
  const allMarketInfos = await connection.getMultipleAccountsInfo(allMarketPks);
  const allMarkets = allMarketPks.map((address, i) => Market.loadFromBuffer({ address, buffer: allMarketInfos[i]!.data }));
  const [marketOrder] = allMarkets.flatMap(m => m.openOrders());
  console.log("marketOrder", marketOrder);
  assert(marketOrder.numBaseTokens === amount, 'correct amount');
  assert(marketOrder.tokenPrice === price, 'correct price');
}

describe('ui_wrapper test', () => {
  it('can place orders and read them back', async () => {
    await testWrapper();
  });
});
