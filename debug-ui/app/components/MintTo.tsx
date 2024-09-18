import { getAtaChecked, getAtaSetupIx, getMintToIx } from '@/lib/spl';
import { getSolscanSigUrl, sleep } from '@/lib/util';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  AccountInfo,
  ParsedAccountData,
  PublicKey,
  RpcResponseAndContext,
  Transaction,
} from '@solana/web3.js';
import { ChangeEvent, ReactElement, useState } from 'react';
import { toast } from 'react-toastify';
import { useAppState } from './AppWalletProvider';
import { ensureError } from '@/lib/error';

const MintTo = (): ReactElement => {
  const { connection: conn } = useConnection();
  const { connected, publicKey: signerPub, signTransaction } = useWallet();
  const { network } = useAppState();

  const [mintToAddr, setMintToAddr] = useState<string>('');
  const [mintUiAmount, setMintUiAmount] = useState<string>('');
  const [mintToMintAddr, setMintToMintAddr] = useState<string>('');

  const handleMintToAddrChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setMintToAddr(e.target.value);
  };

  const handleMintUiAmountChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setMintUiAmount(e.target.value);
  };

  const handleMintToMintAddrChange = (
    e: ChangeEvent<HTMLInputElement>,
  ): void => {
    setMintToMintAddr(e.target.value);
  };

  const mintTokens = async (): Promise<void> => {
    if (!connected || !signerPub || !signTransaction) {
      toast.error('mintTokens: not connected or no signerPub');
      return;
    }

    try {
      const mintPub = new PublicKey(mintToMintAddr);
      const destPub = new PublicKey(mintToAddr);

      const setupIx = await getAtaSetupIx(conn, signerPub, mintPub, destPub);
      if (setupIx) {
        const tx = new Transaction().add(setupIx);
        const { blockhash } = await conn.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = signerPub;
        const signedTx = signTransaction(tx);
        const sig = await conn.sendRawTransaction((await signedTx).serialize());

        // give state time to catch up...
        await sleep(5_000);

        console.log(`create dest ata: ${getSolscanSigUrl(sig, network)}`);
        toast.success(`create dest ata: ${getSolscanSigUrl(sig, network)}`);
      }

      const destAta = await getAtaChecked(conn, mintPub, destPub);

      const mintAcc = await conn.getParsedAccountInfo(mintPub);
      if (!mintAcc) {
        toast.error('no mintAcc');
        return;
      }

      const parsedMintAcc = mintAcc as RpcResponseAndContext<
        AccountInfo<ParsedAccountData>
      >;

      const decimals = parsedMintAcc.value?.data.parsed.info.decimals || 9;
      const amountToMint = BigInt(
        Number(mintUiAmount) * Math.pow(10, decimals),
      );

      const mintToIx = getMintToIx(
        mintPub,
        destAta.address,
        signerPub,
        amountToMint,
      );
      const tx = new Transaction().add(mintToIx);

      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = signerPub;
      const signedTx = await signTransaction(tx);
      const signature = await conn.sendRawTransaction(signedTx.serialize());

      console.log(`mintTo: ${getSolscanSigUrl(signature, network)}`);
      toast.success(`mintTo: ${getSolscanSigUrl(signature, network)}`);
    } catch (err) {
      console.error('mintTokens: error minting tokens', err);
      toast.error(`mintTokens: ${ensureError(err).message}`);
    }
  };

  return (
    <div className="w-full max-w-4xl bg-gray-800 p-8 rounded-lg shadow-lg text-center mt-10">
      <h2 className="text-3xl font-bold mb-6">Mint Tokens</h2>

      <label className="block text-gray-300 mb-2 text-left">
        Mint Address (Token Mint):
      </label>
      <input
        type="text"
        value={mintToMintAddr}
        onChange={handleMintToMintAddrChange}
        placeholder="Mint Address"
        className="w-full p-2 mb-4 bg-gray-700 text-gray-200 rounded"
      />

      <label className="block text-gray-300 mb-2 text-left">
        Destination Address (Mint To Address):
      </label>
      <input
        type="text"
        value={mintToAddr}
        onChange={handleMintToAddrChange}
        placeholder="Address to receive tokens"
        className="w-full p-2 mb-4 bg-gray-700 text-gray-200 rounded"
      />

      <label className="block text-gray-300 mb-2 text-left">
        Amount to Mint (UI Amount):
      </label>
      <input
        type="number"
        value={mintUiAmount}
        onChange={handleMintUiAmountChange}
        placeholder="Amount to mint"
        className="w-full p-2 mb-4 bg-gray-700 text-gray-200 rounded"
      />

      <button
        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded disabled:opacity-50"
        disabled={!connected || !mintToAddr || !mintToMintAddr || !mintUiAmount}
        onClick={mintTokens}
      >
        Mint Tokens
      </button>
    </div>
  );
};

export default MintTo;
