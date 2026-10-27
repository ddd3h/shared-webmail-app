import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor } from '@/lib/work-auth';
import { hasYearEnd, isValidYear, submitProblems } from '@/lib/year-end';
import { loadDeclaration, offeredYears } from '@/lib/year-end-server';

// POST /api/profile/year-end/submit?year=YYYY - hand in my saved declaration to 経理・人事. Everything written for the family has to be filled in.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !hasYearEnd(actor.worker_type, actor.withholding_class)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const year = Number(req.nextUrl.searchParams.get('year'));
  if (!isValidYear(year) || !offeredYears().includes(year)) return NextResponse.json({ error: 'invalid_year' }, { status: 400 });

  const d = await loadDeclaration(actor.id, year);
  if (d.status === 'none') return NextResponse.json({ error: 'not_saved' }, { status: 409 });
  const fields = submitProblems(d.data);
  if (fields.length) return NextResponse.json({ error: 'incomplete', fields }, { status: 400 });
  if (d.status === 'draft') {
    await prisma.year_end_declarations.update({ where: { user_id_year: { user_id: actor.id, year } }, data: { status: 'submitted', submitted_at: new Date() } });
    await logAudit({ actorUserId: actor.id, actionType: 'year_end_submit', targetType: 'year_end_declarations', targetId: actor.id, metadata: { year } });
  }
  return NextResponse.json(await loadDeclaration(actor.id, year));
}
