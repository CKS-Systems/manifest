'use client';

import { FillLogResult } from '@cks-systems/manifest-sdk';
import { ReactElement, useState } from 'react';

const Fills = (_params: { marketAddress: string }): ReactElement => {
  const [fills, setFills] = useState<FillLogResult[]>([]);
  const ws = new WebSocket('ws://localhost:1234');

  ws.onopen = (_message): void => {};

  ws.onmessage = (message): void => {
    console.log(`Received message from fill feed: ${message}`);
    console.log(JSON.parse(message.data));
    const fill: FillLogResult = JSON.parse(message.data);
    setFills(fills.concat([fill]));
  };

  ws.onclose = (_message): void => {
    console.log('Disconnected from fill feed');
  };

  return (
    <div className="m-0 max-w-md text-gray-200 p-4">
      <pre className="bg-gray-800 p-4 rounded-lg text-sm">
        <strong>Fills</strong>
        <table className="table-auto w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="pb-2">Price</th>
              <th className="pb-2">Base Atoms</th>
            </tr>
          </thead>
          <tbody>
            {fills.map((fill, i) => (
              <tr key={i} className="border-b border-gray-700">
                <td className="py-2">{fill.price}</td>
                <td className="py-2">{Number(fill.baseAtoms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </pre>
    </div>
  );
};

export default Fills;
