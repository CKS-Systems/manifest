'use client';

import { fetchMarket } from '@/lib/data';
import { Market, RestingOrder } from '@cks-systems/manifest-sdk';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { ReactElement } from 'react';
import SolscanAddrLink from './SolscanAddrLink';
import { toast } from 'react-toastify';
import { ensureError } from '@/lib/error';
import { formatNotional, formatPrice } from '@/lib/format';

const Orderbook = ({
  marketAddress,
}: {
  marketAddress: string;
}): ReactElement => {
  const [bids, setBids] = useState<RestingOrder[]>([]);
  const [asks, setAsks] = useState<RestingOrder[]>([]);
  const [currentSlot, setCurrentSlot] = useState<number>(0);

  const { connection: conn } = useConnection();
  const { wallet } = useWallet();

  useEffect(() => {
    const updateOrderbook = async (): Promise<void> => {
      try {
        const market: Market = await fetchMarket(
          conn,
          new PublicKey(marketAddress),
        );
        setCurrentSlot(market['slot']);
        const asks: RestingOrder[] = market.asks();
        const bids: RestingOrder[] = market.bids();
        setBids(bids.reverse());
        setAsks(asks);
      } catch (e) {
        console.error('updateOrderbook:', e);
        toast.error(`updateOrderbook: ${ensureError(e).message}`);
      }
    };

    updateOrderbook();
    const id = setInterval(updateOrderbook, 2_000);

    return (): void => clearInterval(id);
  }, [conn, marketAddress]);

  const formatOrder = (restingOrder: RestingOrder, i: number) => {
    let pk = wallet?.adapter?.publicKey;
    let isOwn = pk && pk.equals(restingOrder.trader);
    return (
      <tr
        key={i}
        className={`border-b border-gray-700 ${isOwn && 'text-yellow-600'}`}
      >
        <td className="py-2">{formatPrice(restingOrder.tokenPrice)}</td>
        <td className="py-2">{Number(restingOrder.numBaseTokens)}</td>
        <td className="py-2">
          {Number(restingOrder.lastValidSlot) > 0
            ? Number(restingOrder.lastValidSlot) - currentSlot
            : ''}
        </td>
        <td className="py-2">
          {<SolscanAddrLink address={restingOrder.trader.toBase58()} />}
        </td>
      </tr>
    );
  };

  let divider = '';
  if (bids && bids.length > 0 && asks && asks.length > 0) {
    let spread = Math.max(0, asks[0].tokenPrice / bids[0].tokenPrice - 1);
    let mid = (asks[0].tokenPrice + bids[0].tokenPrice) * 0.5;
    let bidDepth2Pct = bids
      .filter((b) => b.tokenPrice > mid * 0.98)
      .reduce((acc, b) => acc + Number(b.numBaseTokens.toString()), 0)
      .toPrecision(6);
    let askDepth2Pct = bids
      .filter((b) => b.tokenPrice < mid * 1.02)
      .reduce((acc, b) => acc + Number(b.numBaseTokens.toString()), 0)
      .toPrecision(6);
    divider = `spread: ${(spread * 10000).toFixed(2)}bps | depth (bid/ask): ${bidDepth2Pct} / ${askDepth2Pct}`;
  }

  return (
    <div className="m-0 max-w-full text-gray-200 p-4">
      <pre className="bg-gray-800 p-4 rounded-lg text-sm mb-4">
        <strong>Asks</strong>
        <table className="table-auto w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="py-2">Price</th>
              <th className="py-2">Amount</th>
              <th className="py-2">SIF</th>
              <th className="py-2">Maker</th>
            </tr>
          </thead>
          <tbody>
            {asks.slice(Math.max(asks.length - 5, 0)).map(formatOrder)}
          </tbody>
        </table>
      </pre>

      <div className="text-center text-gray-400 my-2">{divider}</div>

      <pre className="bg-gray-800 p-4 rounded-lg text-sm">
        <strong>Bids</strong>
        <table className="table-auto w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="py-2">Price</th>
              <th className="py-2">Amount</th>
              <th className="py-2">SIF</th>
              <th className="py-2">Maker</th>
            </tr>
          </thead>
          <tbody>
            {bids.slice(Math.max(bids.length - 5, 0)).map(formatOrder)}
          </tbody>
        </table>
      </pre>
    </div>
  );
};

export default Orderbook;
