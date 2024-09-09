'use client';

import { fetchMarket } from '@/lib/data';
import { Market, RestingOrder } from '@cks-systems/manifest-sdk';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { ReactElement } from 'react';
import SolscanAddrLink from './SolscanAddrLink';

const Orderbook = ({
  marketAddress,
}: {
  marketAddress: string;
}): ReactElement => {
  const [bids, setBids] = useState<RestingOrder[]>([]);
  const [asks, setAsks] = useState<RestingOrder[]>([]);

  const { connection: conn } = useConnection();

  useEffect(() => {
    const updateOrderbooks = async (): Promise<void> => {
      try {
        const market: Market = await fetchMarket(
          conn,
          new PublicKey(marketAddress),
        );
        const asks: RestingOrder[] = market.asks();
        const bids: RestingOrder[] = market.bids();
        setBids(bids.reverse());
        setAsks(asks);
      } catch (e) {
        console.error('updateOrderbooks:', e);
      }
    };

    updateOrderbooks();
    const id = setInterval(updateOrderbooks, 10_000);

    return (): void => clearInterval(id);
  }, [conn, marketAddress]);

  return (
    <div className="m-0 max-w-full text-gray-200 p-4">
      <pre className="bg-gray-800 p-4 rounded-lg text-sm mb-4">
        <strong>Asks</strong>
        <table className="table-auto w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="py-2">Price</th>
              <th className="py-2">Amount</th>
              <th className="py-2">Maker</th>
            </tr>
          </thead>
          <tbody>
            {asks.slice(Math.max(asks.length - 5, 0)).map((restingOrder, i) => (
              <tr key={i} className="border-b border-gray-700">
                <td className="py-2">{Number(restingOrder.tokenPrice.toFixed(3))}</td>
                <td className="py-2">{Number(restingOrder.numBaseTokens)}</td>
                <td className="py-2">{<SolscanAddrLink address={restingOrder.trader.toBase58()} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </pre>

      <div className="text-center text-gray-400 my-2">====== MID ======</div>

      <pre className="bg-gray-800 p-4 rounded-lg text-sm">
        <strong>Bids</strong>
        <table className="table-auto w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="py-2">Price</th>
              <th className="py-2">Amount</th>
              <th className="py-2">Maker</th>
            </tr>
          </thead>
          <tbody>
            {bids.slice(Math.max(bids.length - 5, 0)).map((restingOrder, i) => (
              <tr key={i} className="border-b border-gray-700">
                <td className="py-2">{Number(restingOrder.tokenPrice.toFixed(3))}</td>
                <td className="py-2">{Number(restingOrder.numBaseTokens)}</td>
                <td className="py-2">{<SolscanAddrLink address={restingOrder.trader.toBase58()} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </pre>
    </div>
  );
};

export default Orderbook;
