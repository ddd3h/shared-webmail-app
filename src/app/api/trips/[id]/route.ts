import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';
import { isValidDateString, toDbDate } from '@/lib/work';
import { MAX_TRIP_DAYS, tripDays } from '@/lib/trip';
import { findOverlap, linesData, loadSelection } from '@/lib/trip-server';
import { notifyTripSubmitted } from '@/lib/work-notify';

const allowanceFields = {
  daily_type_id: z.string().nullable().optional(),
  addon_type_ids: z.array(z.string()).max(30).default([]),
};
const fullSchema = z.object({
  destination: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(2000),
  start_date: z.string().refine(isValidDateString),
  end_date: z.string().refine(isValidDateString),
  ...allowanceFields,
});
const allowanceSchema = z.object(allowanceFields);

// PATCH /api/trips/:id
//  - the applicant edits a pending or rejected request (a rejected one is resubmitted);
//  - an admin adjusts only the allowances (日当・加算金) of a pending or approved request.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  const trip = await prisma.business_trips.findUnique({ where: { id } });
  if (!actor || !trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  const ownerEdit = trip.user_id === actor.id && (trip.status === 'pending' || trip.status === 'rejected');
  const adminAdjust = !ownerEdit && isFinance(actor) && (trip.status === 'pending' || trip.status === 'approved');
  if (!ownerEdit && !adminAdjust) {
    const involved = trip.user_id === actor.id || isFinance(actor);
    return NextResponse.json({ error: involved ? 'not_editable' : 'forbidden' }, { status: involved ? 409 : 403 });
  }

  const start = trip.start_date.toISOString().slice(0, 10);
  const end = trip.end_date.toISOString().slice(0, 10);

  if (ownerEdit) {
    const parsed = fullSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    const d = parsed.data;
    if (d.end_date < d.start_date || tripDays(d.start_date, d.end_date) > MAX_TRIP_DAYS) {
      return NextResponse.json({ error: 'invalid_dates' }, { status: 400 });
    }
    const sel = await loadSelection(d.daily_type_id, d.addon_type_ids);
    if ('error' in sel) return NextResponse.json({ error: sel.error }, { status: 400 });
    const overlap = await findOverlap(trip.user_id, d.start_date, d.end_date, id);
    if (overlap) return NextResponse.json({ error: 'overlap', destination: overlap.destination }, { status: 409 });

    await prisma.$transaction([
      prisma.trip_allowance_lines.deleteMany({ where: { trip_id: id } }),
      prisma.business_trips.update({
        where: { id },
        data: {
          destination: d.destination, purpose: d.purpose, start_date: toDbDate(d.start_date), end_date: toDbDate(d.end_date),
          status: 'pending', reviewed_by_id: null, reviewed_at: null, review_comment: null,
          allowances: { create: linesData(sel.types, d.start_date, d.end_date) },
        },
      }),
    ]);
    if (trip.status === 'rejected') void notifyTripSubmitted(id, true);
    return NextResponse.json({ ok: true });
  }

  const parsed = allowanceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const sel = await loadSelection(parsed.data.daily_type_id, parsed.data.addon_type_ids);
  if ('error' in sel) return NextResponse.json({ error: sel.error }, { status: 400 });
  await prisma.$transaction([
    prisma.trip_allowance_lines.deleteMany({ where: { trip_id: id } }),
    prisma.trip_allowance_lines.createMany({ data: linesData(sel.types, start, end).map(l => ({ ...l, trip_id: id })) }),
  ]);
  await logAudit({
    actorUserId: actor.id, actionType: 'trip_allowance_adjust', targetType: 'business_trips', targetId: id,
    metadata: { user_id: trip.user_id, types: sel.types.map(t => t.id) },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/trips/:id - withdraw your own pending or rejected request
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const trip = await prisma.business_trips.findUnique({ where: { id } });
  if (!trip) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (trip.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (trip.status !== 'pending' && trip.status !== 'rejected') return NextResponse.json({ error: 'not_deletable' }, { status: 409 });
  await prisma.business_trips.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
