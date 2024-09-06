import type { Metadata } from 'next';
import AppWalletProvider from './components/AppWalletProvider';
import './globals.css';
import { ReactElement } from 'react';

export const metadata: Metadata = {
  title: 'Mainfest',
  description: 'Manifest Exchange',
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): ReactElement => {
  return (
    <html lang="en">
      <body>
        <AppWalletProvider>{children}</AppWalletProvider>
      </body>
    </html>
  );
};

export default RootLayout;
