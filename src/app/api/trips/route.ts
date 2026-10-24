import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin } from '@/lib/work-auth';
import { isValidDateString, toDbDate } from '@/lib/work';
import { MAX_TRIP_DAYS, tripDays } from '@/lib/trip';
import { findOverlap, linesData, loadSelection, serializeTrip, tripInclude } from '@/lib/trip-server';
import { notifyTripSubmitted } from '@/lib/work-notify';

// GET /api/trips?scope=mine|all&status=&userId=   (`all` is admin only)
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  const all = sp.get('scope') === 'all';
  if (all && !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const status = sp.get('status');
  if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const scope = all ? (sp.get('userId') ? { user_id: sp.get('userId')! } : {}) : { user_id: actor.id };
  const [rows, pending] = await Promise.all([
    prisma.business_trips.findMany({
      where: { ...scope, ...(status ? { status } : {}) },
      include: tripInclude,
      orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
      take: 300,
    }),
    prisma.business_trips.count({ where: { ...scope, status: 'pending' } }),
  ]);
  return NextResponse.json({ items: rows.map(serializeTrip), pending_count: pending });
}

const tripFields = {
  destination: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(2000),
  start_date: z.string().refine(isValidDateString),
  end_date: z.string().refine(isValidDateString),
  daily_type_id: z.string().nullable().optional(),
  addon_type_ids: z.array(z.string()).max(30).default([]),
};

// POST /api/trips - submit a business trip request
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = z.object(tripFields).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  if (d.end_date < d.start_date || tripDays(d.start_date, d.end_date) > MAX_TRIP_DAYS) {
    return NextResponse.json({ error: 'invalid_dates' }, { status: 400 });
  }
  const sel = await loadSelection(d.daily_type_id, d.addon_type_ids);
  if ('error' in sel) return NextResponse.json({ error: sel.error }, { status: 400 });
  const overlap = await findOverlap(actor.id, d.start_date, d.end_date);
  if (overlap) return NextResponse.json({ error: 'overlap', destination: overlap.destination }, { status: 409 });

  const row = await prisma.business_trips.create({
    data: {
      user_id: actor.id, destination: d.destination, purpose: d.purpose,
      start_date: toDbDate(d.start_date), end_date: toDbDate(d.end_date),
      allowances: { create: linesData(sel.types, d.start_date, d.end_date) },
    },
  });
  void notifyTripSubmitted(row.id);
  return NextResponse.json({ id: row.id }, { status: 201 });
}
