'use client';

import { FillResultUi } from '@/lib/types';
import { FillLogResult, Market } from '@cks-systems/manifest-sdk';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { ReactElement, useEffect, useState, useRef } from 'react';

const Fills = ({ marketAddress }: { marketAddress: string }): ReactElement => {
  const { connection: conn } = useConnection();

  const [fills, setFills] = useState<FillResultUi[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const marketRef = useRef<Market | null>(null);

  useEffect(() => {
    const marketPub = new PublicKey(marketAddress);
    Market.loadFromAddress({
      connection: conn,
      address: marketPub,
    }).then((m) => {
      console.log('got market', m);
      marketRef.current = m;
    });
  }, [conn, marketAddress]);

  useEffect(() => {
    if (!wsRef.current) {
      const ws = new WebSocket('ws://localhost:1234');
      wsRef.current = ws;

      ws.onopen = (message): void => {
        console.log('fill feed opened:', message);
      };

      ws.onmessage = (message): void => {
        const fill: FillLogResult = JSON.parse(message.data);
        const quoteTokens =
          fill.quoteAtoms /
          10 ** Number(marketRef.current?.quoteDecimals() || 0);
        const baseTokens =
          fill.baseAtoms / 10 ** Number(marketRef.current?.baseDecimals() || 0);

        const priceTokens = Number((quoteTokens / baseTokens).toFixed(4));
        const fillUi: FillResultUi = {
          market: fill.market,
          maker: fill.maker,
          taker: fill.taker,
          baseTokens,
          quoteTokens,
          priceTokens,
          takerSide: fill.takerIsBuy ? 'bid' : 'ask',
          slot: fill.slot,
        };

        setFills((prevFills) => [...prevFills, fillUi]);
      };

      ws.onclose = (message): void => {
        console.log('disconnected from fill feed:', message);
      };

      return (): void => {
        ws.close();
        wsRef.current = null;
      };
    }
  }, []); // Empty dependency array ensures this effect only runs once

  return (
    <div className="m-0 max-w-md text-gray-200 p-4">
      <pre className="bg-gray-800 p-4 rounded-lg text-sm">
        <table className="table-auto w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="pb-2">Price</th>
              <th className="pb-2">Base Tokens</th>
            </tr>
          </thead>
          <tbody>
            {fills.map((fill, i) => (
              <tr key={i} className="border-b border-gray-700">
                <td className="py-2">{fill.priceTokens}</td>
                <td className="py-2">{Number(fill.baseTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </pre>
    </div>
  );
};

export default Fills;
