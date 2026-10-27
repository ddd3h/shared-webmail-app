import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, requireAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidDateString } from '@/lib/work';
import { MAX_ADDRESS_LENGTH } from '@/lib/mileage';
import { describeRoute, googleTransitLink, yahooTransitLink } from '@/lib/transit';
import { transitInApp, transitRoute } from '@/lib/transit-route';

// GET /api/expenses/transit - can the route be shown in the app? (only with the Google Maps way of searching)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  return NextResponse.json({ in_app: await transitInApp() });
}

const schema = z.object({
  from: z.string().trim().min(1).max(MAX_ADDRESS_LENGTH),
  to: z.string().trim().min(1).max(MAX_ADDRESS_LENGTH),
  date: z.string().refine(isValidDateString),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

// POST /api/expenses/transit - the best public-transport route (出発 at date/time, Japan time), with links to the free route-search sites.
// Without the Google Maps way of searching, only the links are returned (`in_app: false`).
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const limit = checkRateLimit(`transit:${session.userId}`, 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { from, to, date, time } = parsed.data;
  const q = { from, to, date, time };
  const links = { yahoo: yahooTransitLink(q), google: googleTransitLink(q) };
  const departure = new Date(`${date}T${time ?? '09:00'}:00+09:00`);
  const r = await transitRoute(from, to, departure);
  if (!r.ok && r.reason === 'not_available') return NextResponse.json({ in_app: false, links });
  if (!r.ok) return NextResponse.json({ error: r.reason === 'not_found' ? 'route_not_found' : 'route_failed', in_app: true, links }, { status: r.reason === 'not_found' ? 422 : 502 });
  return NextResponse.json({ in_app: true, links, route: { ...r.route, summary: describeRoute(from, to, r.route) } });
}
