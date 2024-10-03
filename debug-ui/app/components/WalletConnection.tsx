'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { ReactElement } from 'react';

import dynamic from 'next/dynamic';

// https://solana.stackexchange.com/questions/4304/error-hydration-failed-because-the-initial-ui-does-not-match-what-was-rendered
const WalletDisconnectButton = (): ReactElement => {
  const WalletMultiButtonDynamic = dynamic(
    async () =>
      (await import('@solana/wallet-adapter-react-ui')).WalletDisconnectButton,
    { ssr: false },
  );

  return (
    <div className="border hover:border-slate-900 rounded">
      <WalletMultiButtonDynamic />
    </div>
  );
};

// https://solana.stackexchange.com/questions/4304/error-hydration-failed-because-the-initial-ui-does-not-match-what-was-rendered
const WalletConnectButton = (): ReactElement => {
  const WalletMultiButtonDynamic = dynamic(
    async () =>
      (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
    { ssr: false },
  );

  return (
    <div className="border hover:border-slate-900 rounded">
      <WalletMultiButtonDynamic />
    </div>
  );
};

const WalletConnection = (): ReactElement => {
  const { connected } = useWallet();
  return connected ? <WalletDisconnectButton /> : <WalletConnectButton />;
};

export default WalletConnection;
