import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, requireAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { isMileageError, resolveMileage } from '@/lib/mileage-server';
import { MAX_ADDRESS_LENGTH, mapsLink, metersToKm } from '@/lib/mileage';

const schema = z.object({
  destination: z.string().trim().min(1).max(MAX_ADDRESS_LENGTH),
  origin: z.string().trim().max(MAX_ADDRESS_LENGTH).optional(), // empty = home
  manual_one_way_km: z.number().positive().max(1000).optional(),
});

// POST /api/expenses/mileage/estimate - "how much would this trip be?" before the claim is sent.
// Each search is billed by the route service, so it is limited per person.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const limit = checkRateLimit(`mileage:${session.userId}`, 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const r = await resolveMileage(session.userId, { destination: parsed.data.destination, origin: parsed.data.origin, manual_one_way_km: parsed.data.manual_one_way_km });
  if (isMileageError(r)) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({
    origin: r.origin, destination: r.destination, round_trip_km: metersToKm(r.distance_m), one_way_km: metersToKm(r.one_way_m),
    rate_per_km: r.rate, amount: r.amount, source: r.source, map_url: mapsLink(r.origin, r.destination),
  });
}
