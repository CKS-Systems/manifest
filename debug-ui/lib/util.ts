import { ManifestClient } from '@cks-systems/manifest-sdk';
import {
  SendTransactionOptions,
  WalletAdapterNetwork,
} from '@solana/wallet-adapter-base';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionSignature,
  VersionedTransaction,
} from '@solana/web3.js';

type SendTransaction = (
  transaction: Transaction | VersionedTransaction,
  connection: Connection,
  options?: SendTransactionOptions,
) => Promise<TransactionSignature>;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const setupClient = async (
  conn: Connection,
  marketPub: PublicKey,
  signerPub: PublicKey | null,
  connected: boolean,
  sendTransaction: SendTransaction,
): Promise<ManifestClient> => {
  if (!connected) {
    throw new Error('must be connected before setting up client');
  }

  const { setupNeeded, instructions, wrapperKeypair } =
    await ManifestClient.getSetupIxs(conn, marketPub, signerPub as PublicKey);

  if (setupNeeded) {
    console.log(`sending ${instructions.length} setup ixs...`);
    const tx = new Transaction().add(...instructions);
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = signerPub!;
    if (wrapperKeypair) {
      tx.sign(wrapperKeypair);
    }

    const sig = await sendTransaction(tx, conn);

    console.log(
      `setupTx: https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    );

    console.log('sleeping 5 seconds to ensure state catches up');

    await sleep(5_000);
  }

  const mClient = await ManifestClient.getClientForMarketNoPrivateKey(
    conn,
    marketPub,
    signerPub as PublicKey,
  );

  return mClient;
};

export const getSolscanUrl = (
  address: string,
  cluster: WalletAdapterNetwork,
): string => {
  const baseUrl = 'https://solscan.io';
  const clusterPath =
    cluster !== WalletAdapterNetwork.Mainnet ? `?cluster=${cluster}` : '';
  return `${baseUrl}/account/${address}${clusterPath}`;
};

export const shortenAddress = (address: string): string => {
  return `${address.slice(0, 3)}...${address.slice(-3)}`;
};
