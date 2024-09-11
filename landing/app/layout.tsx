import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Footer from './component/shared/Footer/Footer';
import TopBar from './component/shared/AppBar/TopBar';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://manifest.trade'),
  title: 'Manifest',
  description: 'The Unlimited Orderbook',
   keywords: ['DeFi', 'Crypto', 'Solana', 'Manifest', 'DEX', 'Finance', 'Decentralized Finance', 'Token Vaults', 'Crypto API', 'DeFi Data'],
   creator: 'CKS Systems',
   twitter: {
    card: 'summary_large_image',
    title: 'Manifest',
    description: 'Forever free 🗽 3rd-gen Solana Orderbook 📚',
    siteId: '',
    creator: '@manifest.trades',
    creatorId: '',
    images: [{
      url: '',
      alt: 'Manifest X Image'
    }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en'>
      <body className={inter.className}>
        <TopBar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
