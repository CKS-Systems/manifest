'use client';

import { ReactElement, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const Home = (): ReactElement => {
  const [marketAddress, setMarketAddress] = useState<string>('');
  const router = useRouter();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setMarketAddress(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (marketAddress.trim() !== '') {
      router.push(`/market/${marketAddress.trim()}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-gray-200 p-8">
      <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center">
          Manifest Debugger UI
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label htmlFor="marketAddress" className="font-semibold">
            Enter Market Address:
          </label>
          <input
            type="text"
            id="marketAddress"
            value={marketAddress}
            onChange={handleInputChange}
            placeholder="e.g., CbJTXhT8GdyjLoY751bjBbgjzFusBEFmwxahBxBsVqBA"
            className="bg-gray-700 border border-gray-600 rounded p-2 text-gray-200 focus:outline-none focus:border-gray-500"
            required
          />
          <button
            type="submit"
            className="py-2 px-4 rounded bg-blue-500 hover:bg-blue-600 transition-colors text-white disabled:opacity-50"
            disabled={marketAddress.trim() === ''}
          >
            Go to Market
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="mb-2">
            Or view an{' '}
            <Link
              href="/market/CbJTXhT8GdyjLoY751bjBbgjzFusBEFmwxahBxBsVqBA"
              className="text-blue-400 underline hover:text-blue-500 transition-colors"
            >
              example market
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
};

export default Home;
