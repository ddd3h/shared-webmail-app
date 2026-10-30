import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { toDbDate, usesReports } from '@/lib/work';
import { z } from 'zod';
import { isValidDateString } from '@/lib/work';
import { oneReportPerPeriod } from '@/lib/work-reports';
import { reportInPeriod } from '@/lib/work-reports-server';
import { activityNote, checkReportActivity } from '@/lib/activity-check';

const schema = z.object({
  report_date: z.string().refine(isValidDateString),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
  hours: z.number().min(0).max(999).nullable().optional(),
  activity_ack: z.boolean().optional(),
});

async function loadOwned(id: string, userId: string) {
  const actor = await getActor(userId);
  const report = await prisma.work_reports.findUnique({ where: { id } });
  return { actor, report };
}

// PATCH /api/work/reports/:id - the author edits their own report
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const { actor, report } = await loadOwned(id, session.userId);
  if (!actor || !report) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (report.user_id !== actor.id || !usesReports(actor.worker_type)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  // 準業務委託は1期間に1通: 日付を変えて、すでに別の報告書がある期間に移すことはできない
  if (oneReportPerPeriod(actor.worker_type)) {
    const other = await reportInPeriod(actor.id, actor.worker_type, d.report_date, id);
    if (other) return NextResponse.json({ error: 'period_already_reported', id: other.id, report_date: other.report_date }, { status: 409 });
  }
  // 日付を変えたときだけ、ログインの記録を調べ直す（本文だけ直すときは、前の印をそのまま残す）
  const dateChanged = toDbDate(d.report_date).getTime() !== report.report_date.getTime();
  const verdict = dateChanged ? await checkReportActivity(actor, d.report_date) : null;
  if (verdict?.suspicious && !d.activity_ack) {
    return NextResponse.json({ error: 'activity_warning', days: verdict.days, last_login: verdict.last_login }, { status: 409 });
  }
  await prisma.work_reports.update({
    where: { id },
    data: {
      report_date: toDbDate(d.report_date), title: d.title, content: d.content, hours: d.hours ?? null,
      ...(dateChanged ? (verdict?.suspicious
        ? { activity_flag: true, activity_note: activityNote(verdict), activity_ack_at: new Date() }
        : { activity_flag: false, activity_note: null, activity_ack_at: null }) : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/work/reports/:id - the author or an admin
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const { actor, report } = await loadOwned(id, session.userId);
  if (!actor || !report) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (report.user_id !== actor.id && !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await prisma.work_reports.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
