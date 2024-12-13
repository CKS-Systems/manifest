'use client';

import { ReactElement, useState } from 'react';
import Link from 'next/link';
import { useAppState } from './components/AppWalletProvider';
import { addrToLabel } from '@/lib/address-labels';
import Toggle from 'react-toggle';
import 'react-toggle/style.css';

const Home = (): ReactElement => {
  const readOnly = process.env.NEXT_PUBLIC_READ_ONLY === 'true';
  const {
    marketAddrs,
    loading,
    labelsByAddr,
    infoByAddr,
    marketVolumes,
    activeByAddr,
    dailyVolumes,
    hasToken22ByAddr,
  } = useAppState();
  const [showAll, setShowAll] = useState<boolean>(false);

  function handleShowAllChange(event: { target: { checked: boolean } }) {
    setShowAll(event.target.checked);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-gray-200 p-8">
      <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-2xl">
        <p className="text-sm text-gray-400 mb-6 p-4 bg-gray-700 rounded-lg leading-relaxed">
          <strong className="block mb-2 font-semibold text-gray-300">
            Disclaimer
          </strong>
          By accessing and using Manifest, you acknowledge and agree that you do
          so at your own risk. This platform is intended for developers ONLY and
          may not be actively supported or maintained. The developers,
          contributors, and associated parties are not liable for any losses,
          damages, or claims arising from your use of this platform. This
          platform is provided "as is" without any warranties or guarantees.
          Users are responsible for complying with all applicable laws and
          regulations in their jurisdiction. Please exercise caution.
        </p>

        {loading ? (
          <p className="text-center text-lg font-medium">Loading markets...</p>
        ) : marketAddrs.length > 0 ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-semibold text-gray-100">
                Existing Markets
              </h2>
              <div className="flex items-center gap-2">
                <Toggle
                  defaultChecked={false}
                  icons={false}
                  onChange={handleShowAllChange}
                />
                <span className="text-sm text-gray-300">Show All</span>
              </div>
            </div>

            <ul className="space-y-4 bg-gray-700 p-4 rounded-lg shadow-inner">
              {marketAddrs.map(
                (market, index) =>
                  (showAll || activeByAddr[market]) && (
                    <li
                      key={index}
                      className="bg-gray-600 p-4 rounded-lg hover:bg-gray-500 transition-all duration-200 hover:shadow-md"
                    >
                      <Link
                        href={`/${readOnly ? 'market' : 'interact'}/${market}`}
                        className="text-blue-400 underline hover:text-blue-300 text-lg font-medium"
                        title={infoByAddr[market] || 'unknown'}
                      >
                        {addrToLabel(market, labelsByAddr)}
                      </Link>

                      {hasToken22ByAddr[market] && (
                        <span className="ml-3 inline-block bg-blue-500 text-white text-xs font-semibold px-2 py-1 rounded">
                          TOKEN_2022
                        </span>
                      )}
                      <div className="mt-2 text-sm text-gray-200">
                        {marketVolumes[market] !== 0 && (
                          <>
                            Total: $
                            {marketVolumes[market]?.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </>
                        )}
                        {dailyVolumes[market] !== 0 &&
                          dailyVolumes[market] !== undefined && (
                            <>
                              {' | 24 Hour: $'}
                              {dailyVolumes[market]?.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </>
                          )}
                      </div>
                    </li>
                  ),
              )}
            </ul>
          </>
        ) : (
          <p className="text-center text-lg font-medium">No markets found.</p>
        )}
      </div>
    </main>
  );
};

export default Home;
