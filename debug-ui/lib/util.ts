import { ManifestClient } from '@cks-systems/manifest-sdk';
import { SendTransactionOptions } from '@solana/wallet-adapter-base';
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

export const setupClient = async (
  conn: Connection,
  marketPub: PublicKey,
  signerPub: PublicKey,
  connected: boolean,
  sendTransaction: SendTransaction,
): Promise<ManifestClient> => {
  if (!connected) {
    throw new Error('must be connected before setting up client');
  }

  const setupIxs = await ManifestClient.getSetupIxs(
    conn,
    marketPub,
    signerPub as PublicKey, // checked connected above
  );

  if (setupIxs.length > 0) {
    console.log('sending setup ixs...');
    const sig = await sendTransaction(
      new Transaction().add(...setupIxs),
      conn,
      { skipPreflight: false },
    );
    console.log(
      `setupTx: https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    );
  }

  const mClient = await ManifestClient.getClientForMarketNoPrivateKey(
    conn,
    marketPub,
    signerPub as PublicKey,
  );

  return mClient;
};
