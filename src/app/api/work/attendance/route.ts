import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, getWorkSettings, isFinance } from '@/lib/work-auth';
import { notifyAttendanceEdited } from '@/lib/work-notify';
import {
  allowedPunches, isValidDateString, isValidMonth, jstDateString, monthRange, summarizeMonth, toDbDate, workedMinutes,
} from '@/lib/work';

// GET /api/work/attendance?month=YYYY-MM&userId=
// Employees see their own records; admins can look at anyone's.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  const month = sp.get('month') || jstDateString(new Date()).slice(0, 7);
  if (!isValidMonth(month)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });

  const targetId = sp.get('userId') || actor.id;
  const isSelf = targetId === actor.id;
  if (!isSelf && !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (isSelf && actor.worker_type !== 'employee' && !isFinance(actor)) {
    return NextResponse.json({ error: 'not_employee' }, { status: 403 });
  }
  const target = isSelf ? actor : await getActor(targetId);
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const settings = await getWorkSettings();
  const { start, end } = monthRange(month);
  const rows = await prisma.attendance_records.findMany({
    where: { user_id: target.id, work_date: { gte: start, lt: end } },
    orderBy: { work_date: 'asc' },
  });

  const records = rows.map(r => ({
    id: r.id,
    work_date: r.work_date.toISOString().slice(0, 10),
    clock_in_at: r.clock_in_at,
    clock_out_at: r.clock_out_at,
    break_started_at: r.break_started_at,
    break_minutes: r.break_minutes,
    worked_minutes: workedMinutes(r, settings.auto_break_minutes),
    note: r.note,
    edited: !!r.edited_by_id,
  }));

  let today = null;
  if (isSelf && actor.worker_type === 'employee') {
    // An unfinished shift (e.g. past midnight) takes priority over today's row.
    const open = await prisma.attendance_records.findFirst({
      where: { user_id: actor.id, clock_out_at: null, clock_in_at: { gte: new Date(Date.now() - 24 * 3600_000) } },
      orderBy: { clock_in_at: 'desc' },
    });
    const todayRow = open ?? await prisma.attendance_records.findUnique({
      where: { user_id_work_date: { user_id: actor.id, work_date: toDbDate(jstDateString(new Date())) } },
    });
    today = {
      clock_in_at: todayRow?.clock_in_at ?? null,
      clock_out_at: todayRow?.clock_out_at ?? null,
      break_started_at: todayRow?.break_started_at ?? null,
      allowed: allowedPunches(todayRow),
    };
  }

  return NextResponse.json({
    user: { id: target.id, name: target.name, worker_type: target.worker_type },
    month, records, today, settings,
    summary: summarizeMonth(rows, settings.daily_minutes, settings.auto_break_minutes),
  });
}

const upsertSchema = z.object({
  userId: z.string().min(1),
  work_date: z.string().refine(isValidDateString),
  clock_in_at: z.coerce.date().nullable(),
  clock_out_at: z.coerce.date().nullable(),
  break_minutes: z.number().int().min(0).max(1440).default(0),
  note: z.string().max(500).nullable().optional(),
}).refine(v => !v.clock_in_at || !v.clock_out_at || v.clock_out_at >= v.clock_in_at, { message: 'out_before_in' })
  .refine(v => !v.clock_out_at || !!v.clock_in_at, { message: 'out_without_in' });

// PUT /api/work/attendance - correct or add a day (admin only)
export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = upsertSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  if (!(await getActor(d.userId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const data = {
    clock_in_at: d.clock_in_at, clock_out_at: d.clock_out_at, break_minutes: d.break_minutes,
    break_started_at: null, note: d.note || null, edited_by_id: actor.id,
  };
  const row = await prisma.attendance_records.upsert({
    where: { user_id_work_date: { user_id: d.userId, work_date: toDbDate(d.work_date) } },
    create: { ...data, user_id: d.userId, work_date: toDbDate(d.work_date) },
    update: data,
  });
  await logAudit({
    actorUserId: actor.id, actionType: 'attendance_edit', targetType: 'attendance_records', targetId: row.id,
    metadata: { user_id: d.userId, work_date: d.work_date },
  });
  if (d.userId !== actor.id) void notifyAttendanceEdited(d.userId, d.work_date);
  return NextResponse.json({ id: row.id });
}

// DELETE /api/work/attendance?id= (admin only)
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const id = new URL(req.url).searchParams.get('id') || '';
  const row = await prisma.attendance_records.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.attendance_records.delete({ where: { id } });
  await logAudit({
    actorUserId: actor.id, actionType: 'attendance_delete', targetType: 'attendance_records', targetId: id,
    metadata: { user_id: row.user_id, work_date: row.work_date.toISOString().slice(0, 10) },
  });
  return NextResponse.json({ ok: true });
}
