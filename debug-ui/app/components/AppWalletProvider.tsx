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
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import WalletConnection from './WalletConnection';
import { ManifestClient } from '@cks-systems/manifest-sdk';
import { Connection } from '@solana/web3.js';
import { ToastContainer, toast } from 'react-toastify';
import { ensureError } from '@/lib/error';

require('@solana/wallet-adapter-react-ui/styles.css');
require('react-toastify/dist/ReactToastify.css');

interface AppStateContextValue {
  loading: boolean;
  network: WalletAdapterNetwork | null;
  marketAddrs: string[];
  setMarketAddrs: Dispatch<SetStateAction<string[]>>;
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
  const [loading, setLoading] = useState<boolean>(false);
  const setupRun = useRef(false);

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) {
    toast.error('RPC_URL not set');
    throw new Error('RPC_URL not set');
  }

  const determineNetworkFromRpcUrl = (url: string): WalletAdapterNetwork => {
    if (url.includes('mainnet')) {
      return WalletAdapterNetwork.Mainnet;
    } else if (url.includes('devnet')) {
      return WalletAdapterNetwork.Devnet;
    } else if (url.includes('testnet')) {
      return WalletAdapterNetwork.Testnet;
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
        console.log('loading initial state');
        const detectedNetwork = determineNetworkFromRpcUrl(rpcUrl);
        setNetwork(detectedNetwork);

        const conn = new Connection(rpcUrl);
        const marketPubs = await ManifestClient.listMarketPublicKeys(conn);
        const marketAddrs = marketPubs.map((p) => p.toBase58());
        const filteredAddrs = marketAddrs.filter(
          (a) => a !== '6XdExjwhzXMHmKLCJS2YKvpVhGswa4K84NNY2L4c2eks',
        );
        setMarketAddrs(filteredAddrs);
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
    return [new SolflareWalletAdapter({ network })];
  }, [network]);

  if (!network) {
    return <div>Loading...</div>;
  }

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets}>
        <WalletModalProvider>
          <AppStateContext.Provider
            value={{ network, marketAddrs, setMarketAddrs, loading }}
          >
            <WalletConnection />
            {children}
            <div className="fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50 pointer-events-none">
              {network ? `connected to ${network}` : 'loading network...'}
            </div>
            <ToastContainer />
          </AppStateContext.Provider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default AppWalletProvider;
