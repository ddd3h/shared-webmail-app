import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET /api/mfi/candles?days=30
// Returns daily OHLC candles for the lightweight-charts candlestick
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const days = Math.min(90, parseInt(new URL(req.url).searchParams.get('days') ?? '30', 10));
  const since = new Date(Date.now() - days * 86400 * 1000);

  const snapshots = await prisma.mfi_snapshots.findMany({
    where: { user_id: session!.userId, recorded_at: { gte: since } },
    orderBy: { recorded_at: 'asc' },
    select: { recorded_at: true, price: true, volume: true },
  });

  // Group into 1-hour buckets (JST = UTC+9).
  // Shift timestamps by +9h before bucketing so bucket boundaries align to JST hours,
  // then return the shifted value so lightweight-charts (which treats numbers as UTC)
  // displays the correct JST wall-clock time.
  const JST_OFFSET_MS = 9 * 3600 * 1000;
  const buckets = new Map<number, { open: number; high: number; low: number; close: number; volume: number }>();

  for (const s of snapshots) {
    const hourTs = Math.floor((s.recorded_at.getTime() + JST_OFFSET_MS) / 86400000) * 86400; // JST day-aligned Unix seconds
    if (!buckets.has(hourTs)) {
      buckets.set(hourTs, { open: s.price, high: s.price, low: s.price, close: s.price, volume: s.volume });
    } else {
      const b = buckets.get(hourTs)!;
      b.high = Math.max(b.high, s.price);
      b.low = Math.min(b.low, s.price);
      b.close = s.price;
      b.volume += s.volume;
    }
  }

  const candles = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([time, b]) => ({
      time,
      open: Math.round(b.open * 100) / 100,
      high: Math.round(b.high * 100) / 100,
      low: Math.round(b.low * 100) / 100,
      close: Math.round(b.close * 100) / 100,
      volume: Math.round(b.volume * 10) / 10,
    }));

  return NextResponse.json({ candles });
}
