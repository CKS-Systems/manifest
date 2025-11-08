'use client';

import { ChangeEvent, ReactElement, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey } from '@solana/web3.js';
import { Market, OrderType, UiWrapper } from '@cks-systems/manifest-sdk';
import { getSolscanSigUrl } from '@/lib/util';
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
  const [orderType, setOrderType] = useState('0');
  const [spreadBps, setSpreadBps] = useState('0');

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

  const handleOrderTypeChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    setOrderType(e.target.value);
  };

  const handleSpreadBpsChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setSpreadBps(e.target.value);
  };

  const onSubmit = async (e: { preventDefault: () => void }): Promise<void> => {
    e.preventDefault();

    const marketPub: PublicKey = new PublicKey(marketAddress);

    if (!connected || !signerPub) {
      toast.error('Connect wallet before placing an order');
      return;
    }

    const amountNum = Number(amount);
    const priceNum = Number(price);
    const clientOrderIdNum = Number(clientOrderId);

    if (Number.isNaN(amountNum) || amountNum <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    if (Number.isNaN(priceNum) || priceNum <= 0) {
      toast.error('Enter a valid price');
      return;
    }

    if (Number(orderType) === OrderType.Reverse) {
      toast.error('Reverse orders not supported via UI wrapper yet');
      return;
    }

    const market = await Market.loadFromAddress({
      connection: conn,
      address: marketPub,
    });

    const { ixs, signers } = await UiWrapper.placeOrderCreateIfNotExistsIxs(
      conn,
      market.baseMint(),
      market.baseDecimals(),
      market.quoteMint(),
      market.quoteDecimals(),
      signerPub,
      signerPub,
      {
        isBid: side === 'buy',
        amount: amountNum,
        price: priceNum,
        orderId: clientOrderIdNum > 0 ? clientOrderIdNum : undefined,
      },
    );

    if (ixs.length === 0) {
      toast.error('Failed to build place order transaction');
      return;
    }

    const tx = new Transaction().add(...ixs);
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = signerPub;
    signers.forEach((signer) => tx.partialSign(signer));

    try {
      const sig = await sendTransaction(
        tx,
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

      <div className="mb-6">
        <label className="block text-gray-200 font-bold mb-2" htmlFor="amount">
          OrderType
        </label>

        <select
          value={orderType}
          onChange={handleOrderTypeChange}
          className="bg-gray-800 border border-gray-700 rounded w-full py-2 px-4 text-gray-200 focus:outline-none focus:border-gray-500"
        >
          {Object.keys(OrderType)
            .filter((v) => isNaN(Number(v)))
            .map((key, index) => (
              <option key={key} value={index}>
                {key}
              </option>
            ))}
        </select>
      </div>

      {Number(orderType) === OrderType.Reverse && (
        <div className="mb-6">
          <label
            className="block text-gray-200 font-bold mb-2"
            htmlFor="spreadBps"
          >
            SpreadBps
          </label>
          <input
            className="bg-gray-800 border border-gray-700 rounded w-full py-2 px-4 text-gray-200 focus:outline-none focus:border-gray-500"
            id="spreadBps"
            type="text"
            value={spreadBps}
            onChange={handleSpreadBpsChange}
          />
        </div>
      )}

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
