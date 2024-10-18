'use client';

import { ReactElement } from 'react';
import Link from 'next/link';
import { useAppState } from './components/AppWalletProvider';
import { addrToLabel } from '@/lib/address-labels';

const Home = (): ReactElement => {
  const readOnly = process.env.NEXT_PUBLIC_READ_ONLY === 'true';
  const { marketAddrs, loading, labelsByAddr } = useAppState();
  console.log(labelsByAddr);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-gray-200 p-8">
      <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-xl">
        <p className="text-sm text-gray-400 mb-6">
          Disclaimer: By accessing and using Manifest, you acknowledge and agree
          that you do so at your own risk. This platform is intended for
          developers ONLY and may not be actively supported or maintained. The
          developers, contributors, and associated parties are not liable for
          any losses, damages, or claims arising from your use of this platform.
          This platform is provided &quot;as is&quot; without any warranties or
          guarantees. Users are responsible for complying with all applicable
          laws and regulations in their jurisdiction. Please exercise caution.
        </p>

        {loading ? (
          <p className="text-center">Loading markets...</p>
        ) : marketAddrs.length > 0 ? (
          <>
            <h2 className="text-xl font-semibold mb-4 text-center">
              Existing Markets
            </h2>
            <ul className="space-y-4 bg-gray-700 p-4 rounded-lg">
              {marketAddrs.map((market, index) => (
                <li
                  key={index}
                  className="bg-gray-600 p-2 rounded-lg hover:bg-gray-500 transition-colors"
                >
                  <Link
                    href={`/${readOnly ? 'market' : 'interact'}/${market}`}
                    className="text-blue-400 underline hover:text-blue-500 transition-colors"
                  >
                    {addrToLabel(market, labelsByAddr)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-center">No markets found.</p>
        )}
      </div>
    </main>
  );
};

export default Home;
