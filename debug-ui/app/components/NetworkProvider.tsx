import React, { ReactElement, createContext, useContext } from 'react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

interface NetworkContextValue {
  network: WalletAdapterNetwork | null;
}

const NetworkContext = createContext<NetworkContextValue | undefined>(
  undefined,
);

// Custom hook to use the network context
export const useNetwork = (): NetworkContextValue => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};

interface NetworkProviderProps {
  children: React.ReactNode;
  network: WalletAdapterNetwork;
}

export const NetworkProvider = ({
  children,
  network,
}: NetworkProviderProps): ReactElement => {
  return (
    <NetworkContext.Provider value={{ network }}>
      {children}
    </NetworkContext.Provider>
  );
};
