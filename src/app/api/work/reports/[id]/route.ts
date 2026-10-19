import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin } from '@/lib/work-auth';
import { toDbDate } from '@/lib/work';
import { z } from 'zod';
import { isValidDateString } from '@/lib/work';

const schema = z.object({
  report_date: z.string().refine(isValidDateString),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
  hours: z.number().min(0).max(999).nullable().optional(),
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
  if (report.user_id !== actor.id || actor.worker_type !== 'contractor') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  await prisma.work_reports.update({
    where: { id },
    data: { report_date: toDbDate(d.report_date), title: d.title, content: d.content, hours: d.hours ?? null },
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
  if (report.user_id !== actor.id && !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await prisma.work_reports.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
