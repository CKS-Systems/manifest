'use client';

import SolscanAddrLink from './SolscanAddrLink';
import { FillResultUi } from '@/lib/types';
import { FillLogResult, Market } from '@cks-systems/manifest-sdk';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { ReactElement, useEffect, useState, useRef } from 'react';
import { toast } from 'react-toastify';

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
      const feedUrl = process.env.NEXT_PUBLIC_FEED_URL;
      if (!feedUrl) {
        toast.error('NEXT_PUBLIC_FEED_URL not set');
        throw new Error('NEXT_PUBLIC_FEED_URL not set');
      }
      const ws = new WebSocket(feedUrl);
      wsRef.current = ws;

      ws.onopen = (message): void => {
        console.log('fill feed opened:', message);
      };

      ws.onmessage = async (message): Promise<void> => {
        const fill: FillLogResult = JSON.parse(message.data);
        if (fill.market !== marketAddress) {
          return;
        }

        const quoteTokens =
          Number(fill.quoteAtoms) /
          10 ** Number(marketRef.current?.quoteDecimals() || 0);
        const baseTokens =
          Number(fill.baseAtoms) /
          10 ** Number(marketRef.current?.baseDecimals() || 0);

        const priceTokens = Number((quoteTokens / baseTokens).toFixed(4));
        const fillUi: FillResultUi = {
          market: fill.market,
          maker: fill.maker,
          taker: fill.taker,
          baseTokens,
          quoteTokens,
          priceTokens,
          isMakerGlobal: fill.isMakerGlobal,
          takerSide: fill.takerIsBuy ? 'bid' : 'ask',
          signature: fill.signature,
          slot: fill.slot,
          dateString: await slotToTimestamp(fill.slot),
        };

        setFills((prevFills) => [fillUi, ...prevFills]);
      };

      ws.onclose = (message): void => {
        console.log('disconnected from fill feed:', message);
      };

      return (): void => {
        ws.close();
        wsRef.current = null;
      };
    }
  });

  async function slotToTimestamp(slot: number): Promise<string> {
    // Local storage isnt necessary here, but if we do ever start saving fills
    // for page refresh, it will be.
    try {
      if (localStorage.getItem(slot.toString())) {
        return localStorage.getItem(slot.toString())!;
      } else {
        const timestamp: number = (await conn.getBlockTime(slot))!;
        const dateString: string = new Date(timestamp * 1_000)
          .toTimeString()
          .slice(0, 9);
        localStorage.setItem(slot.toString(), dateString);
        return dateString;
      }
    } catch (e) {
      console.error('getBlockTime:', e);
    }
    return '';
  }

  return (
    <div className="m-0 max-w-full text-gray-200 p-4">
      <pre className="bg-gray-800 p-4 rounded-lg text-sm">
        <table className="table-auto w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="pb-2">Timestamp</th>
              <th className="pb-2">Price</th>
              <th className="pb-2">Base Tokens</th>
              <th className="pb-2">Maker</th>
              <th className="pb-2">Taker</th>
              <th className="pb-2">Taker Side</th>
              <th className="pb-2">Signature</th>
            </tr>
          </thead>
          <tbody>
            {fills.map((fill: FillResultUi, i) => (
              <tr key={i} className="border-b border-gray-700">
                <td className="py-2">{fill.dateString}</td>
                <td className="py-2">{fill.priceTokens}</td>
                <td className="py-2">{Number(fill.baseTokens)}</td>
                <td className="py-2">
                  {fill.isMakerGlobal ? '🌎' : ''}
                  <SolscanAddrLink address={fill.maker} />
                </td>
                <td className="py-2">
                  <SolscanAddrLink address={fill.taker} />
                </td>
                <td className="py-2">{fill.takerSide}</td>
                {/* Uses the public block explorer because the enhanced one does not have a good public RPC */}
                <td className="py-2">
                  <a
                    target="_blank"
                    rel="noopener noreferrer"
                    href={'https://explorer.solana.com/tx/' + fill.signature}
                  >
                    {fill.signature.substring(0, 5) + '...'}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </pre>
    </div>
  );
};

export default Fills;
