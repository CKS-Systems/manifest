import Chart from '@/app/components/Chart';
import Fills from '../../components/Fills';
import Orderbook from '../../components/Orderbook';
import { ReactElement } from 'react';

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
  </main>
);

export default Market;
