'use client';

import { useEffect, useRef, ReactElement, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CandlestickData,
  Time,
} from 'lightweight-charts';
import { FillLogResult } from '@cks-systems/manifest-sdk';
import { useConnection } from '@solana/wallet-adapter-react';

const Chart = ({ marketAddress }: { marketAddress: string }): ReactElement => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [chartEntries, setChartEntries] = useState<CandlestickData[]>([]);
  const { connection: conn } = useConnection();

  const aggregateFillData = async (
    fill: FillLogResult,
    fillsInInterval: CandlestickData | null,
  ): Promise<CandlestickData> => {
    const time = await conn.getBlockTime(fill.slot);
    if (!time) return fillsInInterval!;

    const timestamp = Math.floor(time / 60) * 60; // Group by minute

    if (!fillsInInterval) {
      return {
        time: timestamp as Time,
        open: fill.price,
        high: fill.price,
        low: fill.price,
        close: fill.price,
      };
    } else {
      return {
        time: timestamp as Time,
        open: fillsInInterval.open,
        high: Math.max(fillsInInterval.high, fill.price),
        low: Math.min(fillsInInterval.low, fill.price),
        close: fill.price,
      };
    }
  };

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:1234');
    let fillsInCurrentInterval: CandlestickData | null = null;

    ws.onmessage = async (message): Promise<void> => {
      const fill: FillLogResult = JSON.parse(message.data);
      const updatedCandlestick = await aggregateFillData(
        fill,
        fillsInCurrentInterval,
      );

      if (
        !fillsInCurrentInterval ||
        updatedCandlestick.time !== fillsInCurrentInterval.time
      ) {
        if (fillsInCurrentInterval) {
          setChartEntries(
            (prevEntries) =>
              [
                ...prevEntries.filter(Boolean),
                fillsInCurrentInterval,
              ] as CandlestickData[],
          );
        }
        fillsInCurrentInterval = updatedCandlestick;
      } else {
        fillsInCurrentInterval = updatedCandlestick;
      }

      candlestickSeriesRef.current?.setData([
        ...chartEntries.filter(Boolean),
        fillsInCurrentInterval,
      ] as CandlestickData[]);
    };

    return () => {
      ws.close();
    };
  }, [chartEntries]);

  useEffect(() => {
    if (chartContainerRef.current) {
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 400,
        layout: {
          background: {
            type: ColorType.Solid,
            color: '#1A202C',
          },
          textColor: '#D3D3D3',
        },
        grid: {
          vertLines: {
            color: '#2B2B43',
          },
          horzLines: {
            color: '#2B2B43',
          },
        },
        timeScale: {
          borderColor: '#485c7b',
        },
        watermark: {
          visible: false,
        },
      });

      chartRef.current = chart;

      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#4caf50',
        downColor: '#ff5252',
        borderDownColor: '#ff5252',
        borderUpColor: '#4caf50',
        wickDownColor: '#ff5252',
        wickUpColor: '#4caf50',
      });

      candlestickSeriesRef.current = candlestickSeries;

      const handleResize = () => {
        if (chartContainerRef.current) {
          chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);

      return () => {
        chart.remove();
        window.removeEventListener('resize', handleResize);
      };
    }
  }, []);

  useEffect(() => {
    candlestickSeriesRef.current?.setData(chartEntries as CandlestickData[]);
  }, [chartEntries]);

  return (
    <div className="bg-gray-800 p-4 rounded-lg w-full">
      <h2 className="text-center text-gray-200 mb-4">
        Market: {marketAddress}
      </h2>
      <div ref={chartContainerRef} className="w-full h-96" />
    </div>
  );
};

export default Chart;
