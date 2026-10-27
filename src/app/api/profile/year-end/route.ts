import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor } from '@/lib/work-auth';
import { hasYearEnd, isValidYear, yearEndSchema } from '@/lib/year-end';
import { currentYear, loadDeclaration, offeredYears, sealData } from '@/lib/year-end-server';

async function applicantOr403() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  return actor && hasYearEnd(actor.worker_type, actor.withholding_class) ? actor : null;
}

function yearOf(req: NextRequest): number | null {
  const raw = req.nextUrl.searchParams.get('year');
  const y = raw === null ? currentYear() : Number(raw);
  return isValidYear(y) && offeredYears().includes(y) ? y : null;
}

// GET /api/profile/year-end?year=YYYY - my own 年末調整 declaration for that year (empty form when I have not started).
// People who are not adjusted here (業務委託, 派遣, …) get `applicable: false`, and the profile shows nothing.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!hasYearEnd(actor.worker_type, actor.withholding_class)) return NextResponse.json({ applicable: false });
  const year = yearOf(req);
  if (year === null) return NextResponse.json({ error: 'invalid_year' }, { status: 400 });
  const d = await loadDeclaration(actor.id, year);
  return NextResponse.json({ applicable: true, years: offeredYears(), default_year: currentYear(), ...d });
}

// PUT /api/profile/year-end?year=YYYY - save my declaration as a draft. Changing something that was already submitted or confirmed
// sends it back to a draft: the staff must look at the new content. The content is not written to the audit log.
export async function PUT(req: NextRequest) {
  const actor = await applicantOr403();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const year = yearOf(req);
  if (year === null) return NextResponse.json({ error: 'invalid_year' }, { status: 400 });
  const parsed = yearEndSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', fields: parsed.error.issues.map(i => i.path.join('.')) }, { status: 400 });

  const data_enc = await sealData(parsed.data);
  await prisma.year_end_declarations.upsert({
    where: { user_id_year: { user_id: actor.id, year } },
    create: { user_id: actor.id, year, data_enc },
    update: { data_enc, status: 'draft', submitted_at: null, confirmed_at: null, confirmed_by_id: null },
  });
  await logAudit({ actorUserId: actor.id, actionType: 'year_end_save', targetType: 'year_end_declarations', targetId: actor.id, metadata: { year } });
  return NextResponse.json(await loadDeclaration(actor.id, year));
}
