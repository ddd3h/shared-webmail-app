import { NextRequest, NextResponse } from 'next/server';
import { recentAuthOrResponse } from '@/lib/reauth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { forbidden, yearEndActor } from '@/lib/finance-guard';
import { WORKER_TYPES, WORKER_TYPE_LABEL, type WorkerType } from '@/lib/work';
import { hasYearEnd, isValidYear, yearEndCsv } from '@/lib/year-end';
import { openRow } from '@/lib/year-end-server';

// GET /api/year-end/export?year=YYYY - the declarations as a CSV (経理・人事・管理者), to carry over into payroll software. Logged.
export async function GET(req: NextRequest) {
  const actor = await yearEndActor();
  if (!actor) return forbidden();
  { const stale = await recentAuthOrResponse(); if (stale) return stale; } // high-risk: a recent proof of who is asking (lib/reauth.ts)
  const year = Number(req.nextUrl.searchParams.get('year'));
  if (!isValidYear(year)) return NextResponse.json({ error: 'invalid_year' }, { status: 400 });

  const users = await prisma.users.findMany({
    where: { worker_type: { in: WORKER_TYPES.filter(t => hasYearEnd(t)) }, withholding_class: 'ko' },
    select: { name: true, worker_type: true, year_end_declarations: { where: { year } } },
    orderBy: { created_at: 'asc' },
  });
  const rows = await Promise.all(users.map(async u => {
    const d = u.year_end_declarations[0] ? await openRow(u.year_end_declarations[0]) : null;
    return { name: u.name, worker_type: WORKER_TYPE_LABEL[u.worker_type as WorkerType] ?? u.worker_type, status: d?.status ?? ('none' as const), data: d?.data ?? null, submitted_at: d?.submitted_at ?? null, confirmed_at: d?.confirmed_at ?? null };
  }));
  await logAudit({ actorUserId: actor.id, actionType: 'year_end_export', targetType: 'year_end_declarations', metadata: { year, count: rows.filter(r => r.data).length } });
  return new NextResponse(yearEndCsv(rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="year-end-${year}.csv"`, 'Cache-Control': 'no-store' },
  });
}
