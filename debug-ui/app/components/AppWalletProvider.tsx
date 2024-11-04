'use client';

import React, {
  useMemo,
  ReactElement,
  ReactNode,
  useState,
  useEffect,
  createContext,
  useContext,
  Dispatch,
  SetStateAction,
  useRef,
} from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import WalletConnection from './WalletConnection';
import { ManifestClient, Market } from '@cks-systems/manifest-sdk';
import {
  AccountInfo,
  Connection,
  GetProgramAccountsResponse,
  PublicKey,
} from '@solana/web3.js';
import { ToastContainer, toast } from 'react-toastify';
import { ensureError } from '@/lib/error';
import {
  Cluster,
  getClusterFromConnection,
} from '@cks-systems/manifest-sdk/utils/solana';
import NavBar from './NavBar';
import { ActiveByAddr, LabelsByAddr, VolumeByAddr } from '@/lib/types';
import { fetchAndSetMfxAddrLabels } from '@/lib/address-labels';

require('react-toastify/dist/ReactToastify.css');
require('@solana/wallet-adapter-react-ui/styles.css');

interface AppStateContextValue {
  loading: boolean;
  network: WalletAdapterNetwork | null;
  marketAddrs: string[];
  labelsByAddr: LabelsByAddr;
  activeByAddr: ActiveByAddr;
  marketVolumes: VolumeByAddr;
  setMarketAddrs: Dispatch<SetStateAction<string[]>>;
  setLabelsByAddr: Dispatch<SetStateAction<LabelsByAddr>>;
  setActiveByAddr: Dispatch<SetStateAction<ActiveByAddr>>;
  setMarketVolumes: Dispatch<SetStateAction<VolumeByAddr>>;
}

const AppStateContext = createContext<AppStateContextValue | undefined>(
  undefined,
);

export const useAppState = (): AppStateContextValue => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppWalletProvider');
  }
  return context;
};

const AppWalletProvider = ({
  children,
}: {
  children: ReactNode;
}): ReactElement => {
  const [network, setNetwork] = useState<WalletAdapterNetwork | null>(null);
  const [marketAddrs, setMarketAddrs] = useState<string[]>([]);
  const [marketVolumes, setMarketVolumes] = useState<VolumeByAddr>({});
  const [labelsByAddr, setLabelsByAddr] = useState<LabelsByAddr>({});
  const [activeByAddr, setActiveByAddr] = useState<ActiveByAddr>({});
  const [loading, setLoading] = useState<boolean>(false);
  const setupRun = useRef(false);

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) {
    toast.error('NEXT_PUBLIC_RPC_URL not set');
    throw new Error('NEXT_PUBLIC_RPC_URL not set');
  }

  const determineNetworkFromRpcUrl = async (
    url: string,
  ): Promise<WalletAdapterNetwork> => {
    if (url.includes('mainnet')) {
      return WalletAdapterNetwork.Mainnet;
    } else if (url.includes('devnet')) {
      return WalletAdapterNetwork.Devnet;
    } else if (url.includes('testnet')) {
      return WalletAdapterNetwork.Testnet;
    }

    // Try to determine the network from the genesis hash.
    const cluster: Cluster = await getClusterFromConnection(
      new Connection(url),
    );
    if (cluster == 'mainnet-beta') {
      return WalletAdapterNetwork.Mainnet;
    } else if (cluster == 'devnet') {
      return WalletAdapterNetwork.Devnet;
    }

    toast.error('determineNetworkFromRpcUrl: Unknown network');
    throw new Error('Unknown network');
  };

  useEffect(() => {
    if (setupRun.current) {
      return;
    }

    setupRun.current = true;

    const fetchState = async (): Promise<void> => {
      try {
        const detectedNetwork = await determineNetworkFromRpcUrl(rpcUrl);
        setNetwork(detectedNetwork);

        const conn: Connection = new Connection(rpcUrl, 'confirmed');
        const marketProgramAccounts: GetProgramAccountsResponse =
          await ManifestClient.getMarketProgramAccounts(conn);
        const marketPubs: PublicKey[] = marketProgramAccounts.map(
          (a) => a.pubkey,
        );
        const marketAddrs: string[] = marketPubs.map((p) => p.toBase58());
        const volumeByAddr: VolumeByAddr = {};
        marketProgramAccounts.forEach(
          (
            a: Readonly<{ account: AccountInfo<Buffer>; pubkey: PublicKey }>,
          ) => {
            const market: Market = Market.loadFromBuffer({
              address: a.pubkey,
              buffer: a.account.data,
            });
            if (
              market.quoteMint().toBase58() ==
              'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
            ) {
              volumeByAddr[market.address.toBase58()] =
                Number(market.quoteVolume()) / 10 ** 6;
            } else {
              volumeByAddr[market.address.toBase58()] = 0;
            }
          },
        );
        setMarketAddrs(marketAddrs);
        setMarketVolumes(volumeByAddr);

        // Fine to do an N^2 search until the number of markets gets too big.
        const activeByAddr: ActiveByAddr = {};
        marketProgramAccounts.forEach(
          (
            acct1: Readonly<{
              account: AccountInfo<Buffer>;
              pubkey: PublicKey;
            }>,
          ) => {
            const market: Market = Market.loadFromBuffer({
              address: acct1.pubkey,
              buffer: acct1.account.data,
            });
            let foundBigger: boolean = false;

            marketProgramAccounts.forEach(
              (
                acct2: Readonly<{
                  account: AccountInfo<Buffer>;
                  pubkey: PublicKey;
                }>,
              ) => {
                const market2: Market = Market.loadFromBuffer({
                  address: acct2.pubkey,
                  buffer: acct2.account.data,
                });
                if (
                  market.baseMint().toString() ==
                    market2.baseMint().toString() &&
                  market.quoteMint().toString() ==
                    market2.quoteMint().toString() &&
                  volumeByAddr[market2.address.toBase58()] >
                    volumeByAddr[market.address.toBase58()]
                ) {
                  foundBigger = true;
                }
              },
            );
            activeByAddr[market.address.toBase58()] = !foundBigger;
          },
        );
        setActiveByAddr(activeByAddr);

        fetchAndSetMfxAddrLabels(conn, marketAddrs, setLabelsByAddr);
      } catch (e) {
        console.error('fetching app state:', e);
        toast.error(`placeOrder: ${ensureError(e).message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchState();
  }, [rpcUrl]);

  const endpoint = useMemo(() => rpcUrl, [rpcUrl]);

  const wallets = useMemo(() => {
    if (!network) return [];
    return [];
  }, [network]);

  if (!network) {
    return <div>Loading...</div>;
  }

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets}>
        <WalletModalProvider>
          <AppStateContext.Provider
            value={{
              network,
              marketAddrs,
              marketVolumes,
              activeByAddr,
              labelsByAddr,
              setLabelsByAddr,
              setMarketAddrs,
              setMarketVolumes,
              setActiveByAddr,
              loading,
            }}
          >
            <WalletConnection />
            <NavBar />
            {children}
            <div className="fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50 pointer-events-none">
              {network ? `connected to ${network}` : 'loading network...'}
            </div>
            <ToastContainer
              position="bottom-right"
              autoClose={15_000}
              theme="dark"
              pauseOnHover={true}
            />
          </AppStateContext.Provider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default AppWalletProvider;
