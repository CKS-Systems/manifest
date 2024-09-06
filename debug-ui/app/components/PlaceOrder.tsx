'use client';

import { ChangeEvent, ReactElement, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  Transaction,
  TransactionInstruction,
  PublicKey,
} from '@solana/web3.js';
import {
  ManifestClient,
  OrderType,
  WrapperPlaceOrderParamsExternal,
} from '@cks-systems/manifest-sdk';

const PlaceOrder = ({
  marketAddress,
}: {
  marketAddress: string;
}): ReactElement => {
  const { connected, sendTransaction, publicKey: signerPub } = useWallet();
  const { connection: conn } = useConnection();

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

    if (!connected) {
      throw new Error(
        'place order submit button should be disabled when not connected',
      );
    }

    const marketPub: PublicKey = new PublicKey(marketAddress);

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
        { skipPreflight: true },
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

    const orderParams: WrapperPlaceOrderParamsExternal = {
      numBaseTokens: Number(amount),
      tokenPrice: Number(price),
      isBid: side == 'buy',
      lastValidSlot: 0,
      orderType: OrderType.Limit,
      minOutTokens: 0,
      clientOrderId: Number(clientOrderId),
    };
    console.log(orderParams);

    const placeOrderIx: TransactionInstruction =
      mClient.placeOrderIx(orderParams);
    try {
      const sig = await sendTransaction(
        new Transaction().add(placeOrderIx),
        conn,
        { skipPreflight: true },
      );
      console.log(
        `placeOrderTx: https://explorer.solana.com/tx/${sig}?cluster=devnet`,
      );
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <form className="w-full max-w-sm">
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

