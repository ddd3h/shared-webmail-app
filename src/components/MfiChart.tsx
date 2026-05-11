'use client';
import { useEffect, useRef } from 'react';

type Candle = {
  time: number;
  open: number; high: number; low: number; close: number;
  volume: number;
};

export default function MfiChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    let chart: any;
    (async () => {
      const { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode } =
        await import('lightweight-charts');

      const el = containerRef.current!;
      chart = createChart(el, {
        width: el.clientWidth,
        height: 260,
        layout: {
          background: { type: ColorType.Solid, color: '#ffffff' },
          textColor: '#6b7280',
        },
        grid: {
          vertLines: { color: '#f3f4f6' },
          horzLines: { color: '#f3f4f6' },
        },
        localization: {
          timeFormatter: (time: number) => {
            const d = new Date(time * 1000);
            return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
          },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#e5e7eb', autoScale: false },
        timeScale: {
          borderColor: '#e5e7eb',
          timeVisible: false,
          tickMarkFormatter: (time: number, tickMarkType: number) => {
            const d = new Date(time * 1000);
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth() + 1;
            const day = d.getUTCDate();
            if (tickMarkType === 0) return `${y}年`;
            if (tickMarkType === 1) return `${m}月`;
            return `${day}日`;
          },
        },
      });

      const JST_OFFSET_MS = 9 * 3600 * 1000;

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 1200 },
        }),
      });

      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#3b82f6',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      candleSeries.setData(candles);
      volumeSeries.setData(candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? '#22c55e55' : '#ef444455' })));

      // Show 30 bars wide regardless of data count; pad left with empty space if needed
      requestAnimationFrame(() => {
        const lastIndex = candles.length - 1;
        chart?.timeScale().setVisibleLogicalRange({ from: lastIndex - 29, to: lastIndex + 0.5 });
      });

      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      });
      ro.observe(el);
      return () => ro.disconnect();
    })();

    return () => { chart?.remove(); };
  }, [candles]);

  if (candles.length === 0) {
    return (
      <div className="h-[260px] flex items-center justify-center text-gray-400 text-sm bg-gray-50 rounded-lg border border-gray-100">
        データ収集中… しばらくお待ちください
      </div>
    );
  }

  return <div ref={containerRef} className="rounded-lg overflow-hidden" style={{ height: 260 }} />;
}
