'use client';

import { ReactElement } from 'react';
import Link from 'next/link';

const NavBar = (): ReactElement => {
  const readOnly = process.env.NEXT_PUBLIC_READ_ONLY === 'true';

  return (
    <nav className="w-full bg-gray-800 p-4 shadow-md">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <Link href="/">
          <p className="text-2xl font-bold text-gray-200 hover:text-white transition-colors">
            Manifest Developer UI
          </p>
        </Link>

        <ul className="flex space-x-6">
          <li>
            <Link
              href="/"
              className="text-gray-200 hover:text-white transition-colors"
            >
              Home
            </Link>
          </li>
          {readOnly ? (
            ''
          ) : (
            <li>
              <Link
                href="/create-market"
                className="text-gray-200 hover:text-white transition-colors"
              >
                Create Market
              </Link>
            </li>
          )}
          {readOnly ? (
            ''
          ) : (
            <li>
              <Link
                href="/panic-button"
                className="text-gray-200 hover:text-white transition-colors"
              >
                Panic Button
              </Link>
            </li>
          )}
        </ul>
      </div>
    </nav>
  );
};

export default NavBar;
