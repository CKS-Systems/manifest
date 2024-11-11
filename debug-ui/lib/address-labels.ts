import { Connection, PublicKey } from '@solana/web3.js';
import { Metaplex } from '@metaplex-foundation/js';
import { ENV, TokenInfo, TokenListProvider } from '@solana/spl-token-registry';
import { Market } from '@cks-systems/manifest-sdk';
import { LabelsByAddr } from './types';
import { Dispatch, SetStateAction } from 'react';

export const getTokenSymbol = async (
  conn: Connection,
  mintPub: PublicKey,
): Promise<string> => {
  const metaplex = Metaplex.make(conn);

  let tokenSymbol;

  const metadataAccount = metaplex.nfts().pdas().metadata({ mint: mintPub });

  const metadataAccountInfo = await conn.getAccountInfo(metadataAccount);
  if (metadataAccountInfo) {
    const token = await metaplex.nfts().findByMint({ mintAddress: mintPub });
    tokenSymbol = token.symbol;
  } else {
    const provider = await new TokenListProvider().resolve();
    const tokenList = provider.filterByChainId(ENV.MainnetBeta).getList();
    const tokenMap: Map<string, TokenInfo> = tokenList.reduce((map, item) => {
      map.set(item.address, item);
      return map;
    }, new Map<string, TokenInfo>());

    const token = tokenMap.get(mintPub.toBase58());
    if (token) {
      tokenSymbol = token.symbol;
    }
  }

  return tokenSymbol || shortenPub(mintPub);
};

export const fetchAndSetMfxAddrLabels = async (
  conn: Connection,
  marketAddrs: Array<string>,
  setLabelsByAddr: Dispatch<SetStateAction<LabelsByAddr>>,
): Promise<Set<string>> => {
  const mints = new Set<string>();
  const markets: Market[] = [];
  await Promise.all(
    marketAddrs.map(async (ma) => {
      const m = await Market.loadFromAddress({
        connection: conn,
        address: new PublicKey(ma),
      });
      markets.push(m);
      mints.add(m.quoteMint().toBase58());
      mints.add(m.baseMint().toBase58());
    }),
  );

  const mintLabels: LabelsByAddr = {};
  await Promise.all(
    Array.from(mints.values()).map(async (m) => {
      try {
        if (localStorage.getItem(m)) {
          mintLabels[m] = localStorage.getItem(m)!;
        } else {
          const symbol = await getTokenSymbol(conn, new PublicKey(m));
          mintLabels[m] = symbol;
          localStorage.setItem(m, symbol);
        }
      } catch (e) {
        console.error('getTokenSymbol:', e);
      }
    }),
  );

  const marketLabels: LabelsByAddr = {};
  for (const m of markets) {
    marketLabels[m.address.toBase58()] =
      `MFX-${pubkeyToLabel(m.baseMint(), mintLabels)}/${pubkeyToLabel(m.quoteMint(), mintLabels)}-${shortenPub(m.address)}`;
  }

  setLabelsByAddr({ ...mintLabels, ...marketLabels });

  return mints;
};

export const shortenAddr = (addr: string): string =>
  `${addr.slice(0, 4)}...${addr.slice(-4)}`;

export const shortenPub = (pub: PublicKey): string =>
  shortenAddr(pub.toBase58());

export const addrToLabel = (
  pubKeyStr: string,
  labelsByAddr: LabelsByAddr,
): string => labelsByAddr[pubKeyStr] || pubKeyStr;

export const pubkeyToLabel = (
  pubKeyStr: PublicKey,
  labelsByAddr: LabelsByAddr,
): string => addrToLabel(pubKeyStr.toBase58(), labelsByAddr);
