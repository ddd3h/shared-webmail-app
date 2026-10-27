import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor } from '@/lib/work-auth';
import { usesAttendance, allowedPunches, jstDateString, toDbDate } from '@/lib/work';

const schema = z.object({ action: z.enum(['clock_in', 'break_start', 'break_end', 'clock_out']) });

// POST /api/work/attendance/punch - 打刻 (everyone who clocks in, always for themselves)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!usesAttendance(actor.worker_type)) return NextResponse.json({ error: 'not_employee' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { action } = parsed.data;

  const now = new Date();
  const workDate = toDbDate(jstDateString(now));
  const open = await prisma.attendance_records.findFirst({
    where: { user_id: actor.id, clock_in_at: { gte: new Date(now.getTime() - 24 * 3600_000) }, clock_out_at: null },
    orderBy: { clock_in_at: 'desc' },
  });
  const current = open ?? await prisma.attendance_records.findUnique({
    where: { user_id_work_date: { user_id: actor.id, work_date: workDate } },
  });
  if (!allowedPunches(current).includes(action)) {
    return NextResponse.json({ error: 'invalid_state', allowed: allowedPunches(current) }, { status: 409 });
  }

  if (action === 'clock_in') {
    // A day that an admin created without a clock-in can be completed by punching in.
    await prisma.attendance_records.upsert({
      where: { user_id_work_date: { user_id: actor.id, work_date: workDate } },
      create: { user_id: actor.id, work_date: workDate, clock_in_at: now },
      update: { clock_in_at: now },
    });
  } else if (action === 'break_start') {
    await prisma.attendance_records.update({ where: { id: current!.id }, data: { break_started_at: now } });
  } else if (action === 'break_end') {
    const mins = Math.max(0, Math.round((now.getTime() - current!.break_started_at!.getTime()) / 60_000));
    await prisma.attendance_records.update({
      where: { id: current!.id },
      data: { break_started_at: null, break_minutes: { increment: mins } },
    });
  } else {
    await prisma.attendance_records.update({ where: { id: current!.id }, data: { clock_out_at: now } });
  }
  return NextResponse.json({ ok: true, at: now });
}
