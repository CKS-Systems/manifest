'use client';

import Chart from '@/app/components/Chart';
import Fills from '../../components/Fills';
import MyStatus from '../../components/MyStatus';
import Orderbook from '../../components/Orderbook';
import PlaceOrder from '../../components/PlaceOrder';
import { ReactElement } from 'react';
import { withAccessControl } from '@/lib/withAccessControl';

const Market = ({
  params: { marketAddr },
}: {
  params: { marketAddr: string };
}): ReactElement => (
  <main className="flex min-h-screen flex-col items-center justify-between p-10 bg-black text-gray-200">
    <div className="grid gap-8 text-center lg:w-full lg:max-w-full lg:grid-cols-2 lg:text-left mb-8">
      <div>
        <h2 className="mb-3 text-2xl font-semibold text-center">Chart</h2>
        <Chart marketAddress={marketAddr} />
      </div>
      <div>
        <h2 className="mb-3 text-2xl font-semibold text-center">Orderbook</h2>
        <Orderbook marketAddress={marketAddr} />
      </div>
    </div>

    <div className="w-full mb-8">
      <h2 className="mb-3 text-2xl font-semibold text-center">Fills</h2>
      <Fills marketAddress={marketAddr} />
    </div>

    <div className="grid gap-8 text-center lg:w-full lg:max-w-full lg:grid-cols-2 lg:text-left">
      <div>
        <h2 className="mb-3 text-2xl font-semibold text-center">My Status</h2>
        <MyStatus marketAddress={marketAddr} />
      </div>
      <div>
        <h2 className="mb-3 text-2xl font-semibold text-center">Place Order</h2>
        <PlaceOrder marketAddress={marketAddr} />
      </div>
    </div>
  </main>
);

export default withAccessControl(Market);
