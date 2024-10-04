'use client';

import { ChangeEvent, ReactElement, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  Transaction,
  TransactionInstruction,
  PublicKey,
} from '@solana/web3.js';
import {
  OrderType,
  WrapperPlaceOrderParamsExternal,
} from '@cks-systems/manifest-sdk';
import { getSolscanSigUrl, setupClient } from '@/lib/util';
import { useAppState } from './AppWalletProvider';
import { toast } from 'react-toastify';
import { ensureError } from '@/lib/error';

const PlaceOrder = ({
  marketAddress,
}: {
  marketAddress: string;
}): ReactElement => {
  const { connected, sendTransaction, publicKey: signerPub } = useWallet();
  const { connection: conn } = useConnection();
  const { network } = useAppState();

  const [price, setPrice] = useState('0');
  const [amount, setAmount] = useState('0');
  const [side, setSide] = useState('buy');
  const [clientOrderId, setClientOrderId] = useState('0');

  const handlePriceChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setPrice(e.target.value);
  };

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setAmount(e.target.value);
  };

  const handleSetBuy = (_event: ChangeEvent<HTMLInputElement>): void => {
    setSide('buy');
  };

  const handleSetSell = (_event: ChangeEvent<HTMLInputElement>): void => {
    setSide('sell');
  };

  const handleSetClientOrderId = (e: ChangeEvent<HTMLInputElement>): void => {
    setClientOrderId(e.target.value);
  };

  const onSubmit = async (e: { preventDefault: () => void }): Promise<void> => {
    e.preventDefault();

    const marketPub: PublicKey = new PublicKey(marketAddress);

    const mClient = await setupClient(
      conn,
      marketPub,
      signerPub,
      connected,
      sendTransaction,
      network,
    );

    const orderParams: WrapperPlaceOrderParamsExternal = {
      numBaseTokens: Number(amount),
      tokenPrice: Number(price),
      isBid: side == 'buy',
      lastValidSlot: 0,
      orderType: OrderType.Limit,
      clientOrderId: Number(clientOrderId),
    };

    const placeOrderIx: TransactionInstruction =
      mClient.placeOrderIx(orderParams);
    try {
      const sig = await sendTransaction(
        new Transaction().add(placeOrderIx),
        conn,
        { skipPreflight: true },
      );
      console.log(`placeOrderTx: ${getSolscanSigUrl(sig, network)}`);
      toast.success(`placeOrderTx: ${getSolscanSigUrl(sig, network)}`);
    } catch (err) {
      console.log(err);
      toast.error(`placeOrder: ${ensureError(err).message}`);
    }
  };

  return (
    <form className="w-full">
      <div className="mb-6">
        <label
          className="block text-gray-200 font-bold mb-2"
          htmlFor="clientOrderId"
        >
          Client Order ID
        </label>
        <input
          className="bg-gray-800 border border-gray-700 rounded w-full py-2 px-4 text-gray-200 focus:outline-none focus:border-gray-500"
          id="clientOrderId"
          type="text"
          value={clientOrderId}
          onChange={handleSetClientOrderId}
        />
      </div>

      <div className="mb-6">
        <label className="block text-gray-200 font-bold mb-2" htmlFor="price">
          Price
        </label>
        <input
          className="bg-gray-800 border border-gray-700 rounded w-full py-2 px-4 text-gray-200 focus:outline-none focus:border-gray-500"
          id="price"
          type="text"
          value={price}
          onChange={handlePriceChange}
        />
      </div>

      <div className="mb-6">
        <label className="block text-gray-200 font-bold mb-2" htmlFor="amount">
          Amount
        </label>
        <input
          className="bg-gray-800 border border-gray-700 rounded w-full py-2 px-4 text-gray-200 focus:outline-none focus:border-gray-500"
          id="amount"
          type="text"
          value={amount}
          onChange={handleAmountChange}
        />
      </div>

      <div className="flex gap-4 mb-6">
        <label className="flex items-center text-gray-200 cursor-pointer">
          <input
            name="side"
            type="radio"
            checked={side === 'buy'}
            className="mr-2"
            onChange={handleSetBuy}
          />
          Buy
        </label>
        <label className="flex items-center text-gray-200 cursor-pointer">
          <input
            name="side"
            type="radio"
            checked={side === 'sell'}
            className="mr-2"
            onChange={handleSetSell}
          />
          Sell
        </label>
      </div>

      <div className="flex justify-center">
        <button
          disabled={!connected}
          onClick={onSubmit}
          className="bg-purple-500 hover:bg-purple-400 text-white font-bold py-2 px-4 rounded disabled:bg-gray-600"
          type="button"
        >
          {connected ? 'Submit' : 'Disabled'}
        </button>
      </div>
    </form>
  );
};

export default PlaceOrder;
