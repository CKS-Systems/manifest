'use client';

import React, { useMemo, ReactElement, ReactNode } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { Adapter, WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import WalletConnection from './WalletConnection';

// Default styles that can be overridden by your app
require('@solana/wallet-adapter-react-ui/styles.css');

const AppWalletProvider = ({
  children,
}: {
  children: ReactNode;
}): ReactElement => {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  const wallets = useMemo(
    (): Adapter[] => [
      new PhantomWalletAdapter({ network: 'devnet' }),
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets}>
        <WalletModalProvider>
          <WalletConnection />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default AppWalletProvider;

