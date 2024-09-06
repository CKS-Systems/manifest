'use client';

import { fetchMarket } from '@/lib/data';
import { setupClient } from '@/lib/util';
import {
  Market,
  RestingOrder,
  WrapperCancelOrderParams,
} from '@cks-systems/manifest-sdk';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { useEffect, useState, ReactElement, ChangeEvent } from 'react';

const MyStatus = ({
  marketAddress,
}: {
  marketAddress: string;
}): ReactElement => {
  const { connected, sendTransaction, publicKey: signerPub } = useWallet();
  const { connection: conn } = useConnection();

  const [baseWalletBalance, setBaseWalletBalance] = useState<number>(0);
  const [quoteWalletBalance, setQuoteWalletBalance] = useState<number>(0);
  const [baseExchangeBalance, setBaseExchangeBalance] = useState<number>(0);
  const [quoteExchangeBalance, setQuoteExchangeBalance] = useState<number>(0);
  const [myBids, setMyBids] = useState<RestingOrder[]>([]);
  const [myAsks, setMyAsks] = useState<RestingOrder[]>([]);
  const [clientOrderId, setClientOrderId] = useState('0');
  const [actOnQuote, setActOnQuote] = useState(true);
  const [amountTokens, setAmountTokens] = useState('0');

  const handleSetClientOrderId = (
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    setClientOrderId(event.target.value);
  };

  const handleSetActOnQuote = (_event: ChangeEvent<HTMLInputElement>): void => {
    setActOnQuote(true);
  };

  const handleSetActOnBase = (_event: ChangeEvent<HTMLInputElement>): void => {
    setActOnQuote(false);
  };

  const handleSetAmountTokens = (
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    setAmountTokens(event.target.value);
  };

  const deposit = async (): Promise<void> => {
    const marketPub = new PublicKey(marketAddress);
    const mClient = await setupClient(
      conn,
      marketPub,
      signerPub,
      connected,
      sendTransaction,
    );

    const mintPub = actOnQuote
      ? mClient.market.quoteMint()
      : mClient.market.baseMint();

    const depositIx = mClient.depositIx(
      signerPub!,
      mintPub,
      Number(amountTokens),
    );
    try {
      const sig = await sendTransaction(new Transaction().add(depositIx), conn);
      console.log(
        `deposit: https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      );
    } catch (err) {
      console.log(err);
    }
  };

  const withdraw = async (): Promise<void> => {
    const marketPub = new PublicKey(marketAddress);
    if (!connected) {
      throw new Error('must be connected before setting up client');
    }

    const mClient = await setupClient(
      conn,
      marketPub,
      signerPub,
      connected,
      sendTransaction,
    );

    const mintPub = actOnQuote
      ? mClient.market.quoteMint()
      : mClient.market.baseMint();

    const withdrawIx = mClient.withdrawIx(
      signerPub!,
      mintPub,
      Number(amountTokens),
    );
    try {
      const sig = await sendTransaction(
        new Transaction().add(withdrawIx),
        conn,
      );
      console.log(
        `withdraw: https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      );
    } catch (err) {
      console.log(err);
    }
  };

  const cancelOrder = async (): Promise<void> => {
    const marketPub = new PublicKey(marketAddress);
    const mClient = await setupClient(
      conn,
      marketPub,
      signerPub as PublicKey,
      connected,
      sendTransaction,
    );

    const cancelParams: WrapperCancelOrderParams = {
      clientOrderId: Number(clientOrderId),
    };
    const cancelOrderIx: TransactionInstruction =
      mClient.cancelOrderIx(cancelParams);
    try {
      const sig = await sendTransaction(
        new Transaction().add(cancelOrderIx),
        conn,
      );
      console.log(
        `cancelOrder: https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      );
    } catch (err) {
      console.log(err);
    }
  };

  const cancelAllOrders = async (): Promise<void> => {
    const marketPub = new PublicKey(marketAddress);
    const mClient = await setupClient(
      conn,
      marketPub,
      signerPub as PublicKey,
      connected,
      sendTransaction,
    );

    const cancelAllIx = mClient.cancelAllIx();

    try {
      const sig = await sendTransaction(
        new Transaction().add(cancelAllIx),
        conn,
      );
      console.log(
        `cancelAllOrders: https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      );
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    if (signerPub) {
      const updateState = async (): Promise<void> => {
        const marketPub = new PublicKey(marketAddress);
        const market: Market = await fetchMarket(conn, marketPub);
        try {
          const baseBalance = await conn.getTokenAccountBalance(
            getAssociatedTokenAddressSync(market.baseMint(), signerPub),
          );
          setBaseWalletBalance(baseBalance.value.uiAmount!);
        } catch (err) {
          console.log(err);
        }
        try {
          const quoteBalance = await conn.getTokenAccountBalance(
            getAssociatedTokenAddressSync(market.quoteMint(), signerPub),
          );
          setQuoteWalletBalance(quoteBalance.value.uiAmount!);
        } catch (err) {
          console.log(err);
        }

        const signerAddr = signerPub.toBase58();
        setMyAsks(
          market
            .asks()
            .filter(
              (restingOrder: RestingOrder) =>
                restingOrder.trader.toBase58() == signerAddr,
            ),
        );
        setMyBids(
          market
            .bids()
            .filter(
              (restingOrder: RestingOrder) =>
                restingOrder.trader.toBase58() == signerAddr,
            ),
        );

        setBaseExchangeBalance(
          market.getWithdrawableBalanceTokens(signerPub, true),
        );
        setQuoteExchangeBalance(
          market.getWithdrawableBalanceTokens(signerPub, false),
        );
      };

      updateState().catch(console.error);
      const id = setInterval(updateState, 10_000);

      return (): void => clearInterval(id);
    }
  }, [signerPub, conn, marketAddress]);

  const NoWallet = (): ReactElement => (
    <h1 className="text-gray-200">Wallet is not connected</h1>
  );

  const WithWallet = (): ReactElement => (
    <div className="flex min-h-screen flex-col items-center justify-evenly p-10">
      <div className="flex flex-col gap-6 text-gray-200">
        <pre className="bg-gray-800 p-4 rounded-lg text-sm">
          <strong>Public Key:</strong> {signerPub?.toString()}
        </pre>
        <pre className="bg-gray-800 p-4 rounded-lg text-sm">
          <strong>Wallet Balances:</strong>
          <ul>
            <li>Base: {baseWalletBalance}</li>
            <li>Quote: {quoteWalletBalance}</li>
          </ul>
        </pre>
        <pre className="bg-gray-800 p-4 rounded-lg text-sm">
          <strong>Exchange Balances:</strong>
          <ul>
            <li>Base: {baseExchangeBalance}</li>
            <li>Quote: {quoteExchangeBalance}</li>
          </ul>
        </pre>

        <div className="flex gap-6">
          <label className="flex items-center cursor-pointer">
            <input
              name="action"
              type="radio"
              checked={actOnQuote}
              onChange={handleSetActOnQuote}
              className="mr-2"
            />
            Quote
          </label>
          <label className="flex items-center cursor-pointer">
            <input
              name="action"
              type="radio"
              checked={!actOnQuote}
              onChange={handleSetActOnBase}
              className="mr-2"
            />
            Base
          </label>
        </div>

        <div className="flex flex-col mb-4">
          <label className="font-bold mb-2">Amount Tokens</label>
          <input
            className="bg-gray-800 border border-gray-700 rounded p-2 text-gray-200 focus:outline-none focus:border-gray-500"
            type="text"
            value={amountTokens}
            onChange={handleSetAmountTokens}
          />
        </div>

        <button
          className="py-2 px-4 rounded bg-blue-500 text-white disabled:opacity-50"
          onClick={deposit}
          disabled={!connected}
        >
          Deposit
        </button>
        <button
          className="py-2 px-4 rounded bg-blue-500 text-white disabled:opacity-50"
          onClick={withdraw}
          disabled={!connected}
        >
          Withdraw
        </button>

        <div className="flex flex-col mb-4">
          <label className="font-bold mb-2">Client Order ID</label>
          <input
            className="bg-gray-800 border border-gray-700 rounded p-2 text-gray-200 focus:outline-none focus:border-gray-500"
            type="text"
            value={clientOrderId}
            onChange={handleSetClientOrderId}
          />
        </div>

        <button
          className="py-2 px-4 rounded bg-red-500 text-white disabled:opacity-50"
          onClick={cancelOrder}
          disabled={!connected}
        >
          {myAsks.length || myBids.length
            ? 'Cancel By Order ID'
            : 'No Orders to Cancel'}
        </button>
        <button
          className="py-2 px-4 rounded bg-red-500 text-white disabled:opacity-50"
          onClick={cancelAllOrders}
          disabled={!connected}
        >
          {myAsks.length || myBids.length
            ? 'Cancel All Orders'
            : 'No Orders to Cancel'}
        </button>

        <pre className="bg-gray-800 p-4 rounded-lg text-sm mt-4">
          <strong>Asks</strong>
          <table className="table-auto w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="py-2">Price</th>
                <th className="py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {myAsks.map((restingOrder: RestingOrder, i: number) => (
                <tr key={i} className="border-b border-gray-700">
                  <td className="py-2">{restingOrder.tokenPrice}</td>
                  <td className="py-2">{Number(restingOrder.numBaseTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </pre>

        <pre className="bg-gray-800 p-4 rounded-lg text-sm mt-4">
          <strong>Bids</strong>
          <table className="table-auto w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="py-2">Price</th>
                <th className="py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {myBids.map((restingOrder: RestingOrder, i: number) => (
                <tr key={i} className="border-b border-gray-700">
                  <td className="py-2">{restingOrder.tokenPrice}</td>
                  <td className="py-2">{Number(restingOrder.numBaseTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </pre>
      </div>
    </div>
  );

  return connected ? <WithWallet /> : <NoWallet />;
};

export default MyStatus;
