import Chart from '@/app/components/Chart';
import Fills from '../../components/Fills';
import MyStatus from '../../components/MyStatus';
import Orderbook from '../../components/Orderbook';
import PlaceOrder from '../../components/PlaceOrder';
import { ReactElement } from 'react';

const Market = ({ params }: { params: { marketPk: string } }): ReactElement => (
  <main className="flex min-h-screen flex-col items-center justify-between p-10 bg-black text-gray-200">
    <div className="grid gap-8 text-center lg:w-full lg:max-w-6xl lg:grid-cols-4 lg:text-left">
      <div className="col-span-2">
        <h2 className="mb-3 text-2xl font-semibold">Chart</h2>
        <Chart marketAddress={params.marketPk} />
      </div>
      <div>
        <h2 className="mb-3 text-2xl font-semibold">Orderbook</h2>
        <Orderbook marketAddress={params.marketPk} />
      </div>
      <div>
        <h2 className="mb-3 text-2xl font-semibold">Place Order</h2>
        <PlaceOrder marketAddress={params.marketPk} />
      </div>
      <div className="col-span-2">
        <h2 className="mb-3 text-2xl font-semibold">My Status</h2>
        <MyStatus marketAddress={params.marketPk} />
      </div>
      <div>
        <h2 className="mb-3 text-2xl font-semibold">Fills</h2>
        <Fills marketAddress={params.marketPk} />
      </div>
    </div>
  </main>
);

export default Market;
