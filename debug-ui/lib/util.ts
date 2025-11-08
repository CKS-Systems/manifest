import { ManifestClient, UiWrapper } from '@cks-systems/manifest-sdk';
import { createClaimSeatInstruction } from '@cks-systems/manifest-sdk/wrapper';
import { PROGRAM_ID as MANIFEST_PROGRAM_ID } from '@cks-systems/manifest-sdk/manifest';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  SendTransactionOptions,
  WalletAdapterNetwork,
} from '@solana/wallet-adapter-base';
import {
  Connection,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
  VersionedTransaction,
} from '@solana/web3.js';
import { toast } from 'react-toastify';

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
  network: WalletAdapterNetwork | null,
): Promise<ManifestClient> => {
  if (!connected || !signerPub) {
    throw new Error('must be connected before setting up client');
  }

  const existingWrapper = await UiWrapper.fetchFirstUserWrapper(conn, signerPub);

  const setupIxs: TransactionInstruction[] = [];
  const setupSigners: Signer[] = [];

  let wrapperPubkey: PublicKey;
  if (existingWrapper) {
    wrapperPubkey = existingWrapper.pubkey;
    const wrapperParsed = UiWrapper.loadFromBuffer({
      address: existingWrapper.pubkey,
      buffer: existingWrapper.account.data,
    });
    const hasSeat = wrapperParsed.marketInfoForMarket(marketPub) !== null;
    if (!hasSeat) {
      setupIxs.push(
        createClaimSeatInstruction({
          owner: signerPub,
          market: marketPub,
          wrapperState: wrapperPubkey,
          manifestProgram: MANIFEST_PROGRAM_ID,
        }),
      );
    }
  } else {
    const setup = await UiWrapper.setupIxs(conn, signerPub, signerPub);
    setupIxs.push(...setup.ixs);
    setupSigners.push(...setup.signers);
    const newWrapperSigner = setup.signers[0];
    if (!newWrapperSigner) {
      throw new Error('failed to generate wrapper signer during setup');
    }
    wrapperPubkey = newWrapperSigner.publicKey;
    setupIxs.push(
      createClaimSeatInstruction({
        owner: signerPub,
        market: marketPub,
        wrapperState: wrapperPubkey,
        manifestProgram: MANIFEST_PROGRAM_ID,
      }),
    );
  }

  if (setupIxs.length > 0) {
    console.log(`sending ${setupIxs.length} setup ixs...`);
    const tx = new Transaction().add(...setupIxs);
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = signerPub;
    setupSigners.forEach((signer) => tx.partialSign(signer));

    const sig = await sendTransaction(tx, conn);

    console.log(`setupTx: ${getSolscanUrl(sig, network)}`);
    toast.success(`setup: ${getSolscanSigUrl(sig, network)}`);

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
  cluster: WalletAdapterNetwork | null = WalletAdapterNetwork.Devnet,
): string => {
  const baseUrl = 'https://solscan.io';
  const clusterPath =
    cluster !== WalletAdapterNetwork.Mainnet ? `?cluster=${cluster}` : '';
  return `${baseUrl}/account/${address}${clusterPath}`;
};

export const getSolscanSigUrl = (
  sig: string,
  cluster: WalletAdapterNetwork | null = WalletAdapterNetwork.Devnet,
): string => {
  const baseUrl = 'https://solscan.io';
  const clusterPath =
    cluster !== WalletAdapterNetwork.Mainnet ? `?cluster=${cluster}` : '';
  return `${baseUrl}/tx/${sig}${clusterPath}`;
};

export const shortenAddress = (address: string): string => {
  return `${address.slice(0, 3)}...${address.slice(-3)}`;
};

export const shortenSig = (address: string): string => {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
};

export const checkForToken22 = async (
  conn: Connection,
  mint: PublicKey,
): Promise<boolean> => {
  const localStorageKey: string = mint.toBase58() + '-Is22';

  if (localStorage.getItem(localStorageKey)) {
    return localStorage.getItem(localStorageKey)! === 'true';
  }

  const acc = await conn.getAccountInfo(mint);
  if (!acc) {
    throw new Error('checkForToken22: account does not exist');
  }

  const is22: boolean = acc.owner.toBase58() !== TOKEN_PROGRAM_ID.toBase58();
  localStorage.setItem(localStorageKey, is22.toString());
  return is22;
};
