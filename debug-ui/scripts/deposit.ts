import 'dotenv/config';
import { ManifestClient, Market } from '@cks-systems/manifest-sdk';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const { RPC_URL, MARKET_ADDRESS, ALICE_PRIVATE_KEY } = process.env;

if (!RPC_URL) {
  throw new Error('RPC_URL missing from env');
}

if (!MARKET_ADDRESS) {
  throw new Error('MARKET_ADDRESS missing from env');
}

if (!ALICE_PRIVATE_KEY) {
  throw new Error('ALICE_PRIVATE_KEY missing from env. using random.');
}

const deposit = async (
  conn: Connection,
  marketAddr: string,
  signer: Keypair,
) => {
  const marketPub = new PublicKey(marketAddr);

  console.log('setting up');
  const mClient: ManifestClient = await ManifestClient.getClientForMarket(
    conn,
    marketPub,
    signer,
  );

  console.log('setup complete');

  const market: Market = await Market.loadFromAddress({
    connection: conn,
    address: marketPub,
  });

  if (!market.hasSeat(signer.publicKey)) {
    console.log('Cannot deposit because does not have seat');
    return;
  }

  const mints = [market.baseMint(), market.quoteMint()];
  const randomMint = mints[Math.floor(Math.random() * mints.length)];

  const traderTokenAccount = getAssociatedTokenAddressSync(
    randomMint,
    signer.publicKey,
  );
  const walletTokens: number = Number(
    (await conn.getTokenAccountBalance(traderTokenAccount, 'finalized')).value
      .uiAmount,
  );

  const depositAmountTokens: number = Math.floor(
    (Math.random() * walletTokens) / 2,
  );
  const depositIx = mClient.depositIx(
    signer.publicKey,
    randomMint,
    depositAmountTokens,
  );
  console.log('depositIx', depositIx.keys);
  const sig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(depositIx),
    [signer],
    {
      commitment: 'finalized',
      skipPreflight: true,
    },
  );
  console.log(
    `deposited ${depositAmountTokens} ${randomMint.toBase58()} tokens in ${sig}`,
  );
};

const main = async () => {
  const conn = new Connection(RPC_URL!);
  const marketAddr = MARKET_ADDRESS!;
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(ALICE_PRIVATE_KEY!.split(',').map(Number)),
  );

  await deposit(conn, marketAddr, signer);
};

main().catch(console.error);
