'use client';

import { ReactElement, useState } from 'react';
import { withAccessControl } from '@/lib/withAccessControl';
import { killswitch } from '@/lib/killswitch';
import { toast } from 'react-toastify';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useAppState } from '../components/AppWalletProvider';

const PanicButton = (): ReactElement => {
  const { connection: conn } = useConnection();
  const { sendTransaction, publicKey: userPub, connected } = useWallet();
  const { marketAddrs, network } = useAppState();

  const [loading, setLoading] = useState(false);

  const handlePanicClick = async (): Promise<void> => {
    try {
      setLoading(true);
      toast.warning('initiating killswitch...');

      await killswitch(conn, marketAddrs, userPub, sendTransaction, network);

      toast.success('killswitch executed');
    } catch (error) {
      toast.error('failed to execute killswitch');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-gray-200 p-8">
      <div className="bg-gray-800 p-10 rounded-lg shadow-lg text-center">
        <h1 className="text-4xl font-bold mb-6 text-red-600">PANIC MODE</h1>
        <p className="text-gray-400 mb-8">
          Press the button below to initiate an emergency cancellation and
          withdrawal of all assets from any market with open orders.
        </p>
        <button
          onClick={handlePanicClick}
          className={`bg-red-600 text-white font-bold py-4 px-8 rounded-lg shadow-lg transition-transform transform hover:scale-105 focus:outline-none ${
            loading ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          disabled={loading || !connected}
        >
          {connected
            ? loading
              ? 'Executing...'
              : 'KILLSWITCH'
            : 'connect wallet to execute'}
        </button>
      </div>
    </div>
  );
};

export default withAccessControl(PanicButton);
