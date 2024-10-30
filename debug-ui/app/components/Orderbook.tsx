'use client';

import { fetchMarket } from '@/lib/data';
import { Market, RestingOrder } from '@cks-systems/manifest-sdk';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  AccountInfo,
  KeyedAccountInfo,
  PublicKey,
  SlotUpdate,
} from '@solana/web3.js';
import { useEffect, useMemo, useState } from 'react';
import { ReactElement } from 'react';
import SolscanAddrLink from './SolscanAddrLink';
import { toast } from 'react-toastify';
import { ensureError } from '@/lib/error';
import { formatPrice } from '@/lib/format';
import { OrderType, PROGRAM_ID } from '@cks-systems/manifest-sdk/manifest';

const Orderbook = ({
  marketAddress,
}: {
  marketAddress: string;
}): ReactElement => {
  const [marketData, setMarketData] = useState<Buffer>();
  const [bids, setBids] = useState<RestingOrder[]>([]);
  const [asks, setAsks] = useState<RestingOrder[]>([]);
  const [currentSlot, setCurrentSlot] = useState<number>(0);

  const { connection: conn } = useConnection();
  const { wallet } = useWallet();

  conn.onAccountChange(
    new PublicKey(marketAddress),
    (accountInfo: AccountInfo<Buffer>) => {
      setMarketData(accountInfo.data);
    },
  );

  useEffect(() => {
    try {
      if (marketData) {
        const market: Market = Market.loadFromBuffer({
          address: new PublicKey(marketAddress),
          buffer: marketData,
          slot: currentSlot,
        });
        const asks: RestingOrder[] = market.asks();
        const bids: RestingOrder[] = market.bids();
        setBids(bids.reverse());
        setAsks(asks);
      }
    } catch (e) {
      console.error('updateOrderbook:', e);
      toast.error(`updateOrderbook: ${ensureError(e).message}`);
    }
  }, [conn, currentSlot, marketData, marketAddress]);

  useEffect(() => {
    // Initial load of the market.
    const initialLoad = async (): Promise<void> => {
      const marketInfo: AccountInfo<Buffer> = (await conn.getAccountInfo(
        new PublicKey(marketAddress),
      ))!;
      setMarketData(marketInfo.data);
    };
    initialLoad();

    const updateSlot = async (): Promise<void> => {
      setCurrentSlot(await conn.getSlot());
    };
    updateSlot();
    // 200 ms is half a slot, so we can expect this to update on each slot.
    const id = setInterval(updateSlot, 200);

    return (): void => clearInterval(id);
  }, [conn]);

  const formatOrder = (restingOrder: RestingOrder, i: number): ReactElement => {
    const pk = wallet?.adapter?.publicKey;
    const isOwn = pk && pk.equals(restingOrder.trader);
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
          {restingOrder.orderType == OrderType.Global ? '🌎' : ''}
          {<SolscanAddrLink address={restingOrder.trader.toBase58()} />}
        </td>
      </tr>
    );
  };

  const dividerText = useMemo(() => {
    if (bids && bids.length > 0 && asks && asks.length > 0) {
      const bestBid = bids[0].tokenPrice;
      const bestAsk = asks[asks.length - 1].tokenPrice;
      const spread = Math.max(0, bestAsk / bestBid - 1);
      const mid = (bestAsk + bestBid) * 0.5;
      const bidDepth2Pct = bids
        .filter((b) => b.tokenPrice > mid * 0.98)
        .reduce((acc, b) => acc + Number(b.numBaseTokens.toString()), 0)
        .toPrecision(6);
      const askDepth2Pct = asks
        .filter((b) => b.tokenPrice < mid * 1.02)
        .reduce((acc, b) => acc + Number(b.numBaseTokens.toString()), 0)
        .toPrecision(6);
      return `spread: ${(spread * 10000).toFixed(2)}bps | depth (bid/ask): ${bidDepth2Pct} / ${askDepth2Pct}`;
    } else {
      return '';
    }
  }, [bids, asks]);

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

      <div className="text-center text-gray-400 my-2">{dividerText}</div>

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
