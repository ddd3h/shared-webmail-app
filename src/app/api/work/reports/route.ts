import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { notifyWorkReportSubmitted } from '@/lib/work-notify';
import { usesReports, isValidDateString, isValidMonth, jstDateString, monthRange, toDbDate } from '@/lib/work';

const serialize = (r: any) => ({
  id: r.id,
  report_date: r.report_date.toISOString().slice(0, 10),
  title: r.title,
  content: r.content,
  hours: r.hours === null ? null : Number(r.hours),
  user: r.user ? { id: r.user.id, name: r.user.name } : undefined,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

// GET /api/work/reports?month=YYYY-MM&userId=
// Contractors see their own reports; admins see everyone's (optionally filtered by userId).
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const admin = isFinance(actor);
  if (!admin && !usesReports(actor.worker_type)) return NextResponse.json({ error: 'not_contractor' }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const month = sp.get('month') || jstDateString(new Date()).slice(0, 7);
  if (!isValidMonth(month)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const { start, end } = monthRange(month);
  const userId = admin ? sp.get('userId') || undefined : actor.id;

  const rows = await prisma.work_reports.findMany({
    where: { report_date: { gte: start, lt: end }, ...(userId ? { user_id: userId } : {}) },
    include: { user: { select: { id: true, name: true } } },
    orderBy: [{ report_date: 'desc' }, { created_at: 'desc' }],
  });
  const items = rows.map(serialize);
  const totalHours = items.reduce((s, r) => s + (r.hours ?? 0), 0);
  return NextResponse.json({ month, items, total_hours: totalHours });
}

const reportSchema = z.object({
  report_date: z.string().refine(isValidDateString),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
  hours: z.number().min(0).max(999).nullable().optional(),
});

// POST /api/work/reports - submit a 業務報告書 (contractors only)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!usesReports(actor.worker_type)) return NextResponse.json({ error: 'not_contractor' }, { status: 403 });
  const parsed = reportSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const row = await prisma.work_reports.create({
    data: { user_id: actor.id, report_date: toDbDate(d.report_date), title: d.title, content: d.content, hours: d.hours ?? null },
  });
  void notifyWorkReportSubmitted(row.id);
  return NextResponse.json({ id: row.id }, { status: 201 });
}
