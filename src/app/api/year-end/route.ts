import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { forbidden, yearEndActor } from '@/lib/finance-guard';
import { WORKER_TYPES } from '@/lib/work';
import { hasYearEnd, isValidYear } from '@/lib/year-end';
import { currentYear, offeredYears, openRow } from '@/lib/year-end-server';

// GET /api/year-end?year=YYYY - everybody's 年末調整 declaration (経理・人事・管理者). The content is personal (family names, birth dates, incomes),
// so each look is logged. People who are adjusted here but have not started appear with status "none".
export async function GET(req: NextRequest) {
  const actor = await yearEndActor();
  if (!actor) return forbidden();
  const raw = req.nextUrl.searchParams.get('year');
  const year = raw === null ? currentYear() : Number(raw);
  if (!isValidYear(year)) return NextResponse.json({ error: 'invalid_year' }, { status: 400 });

  const users = await prisma.users.findMany({
    where: { worker_type: { in: WORKER_TYPES.filter(t => hasYearEnd(t)) }, withholding_class: 'ko' },
    select: { id: true, name: true, worker_type: true, year_end_declarations: { where: { year } } },
    orderBy: { created_at: 'asc' },
  });
  const items = await Promise.all(users.map(async u => {
    const row = u.year_end_declarations[0];
    const d = row ? await openRow(row) : null;
    return {
      user: { id: u.id, name: u.name, worker_type: u.worker_type },
      status: d?.status ?? 'none', data: d?.data ?? null, submitted_at: d?.submitted_at ?? null, confirmed_at: d?.confirmed_at ?? null,
      version: d?.updated_at?.toISOString() ?? null, // what the staff looked at: confirming is refused when it has changed since
    };
  }));
  await logAudit({ actorUserId: actor.id, actionType: 'year_end_list_view', targetType: 'year_end_declarations', metadata: { year, count: items.filter(i => i.data).length } });
  return NextResponse.json({ year, years: offeredYears(), items });
}
