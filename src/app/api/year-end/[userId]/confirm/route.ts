import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { forbidden, selfDealing, selfDealingResponse, yearEndActor } from '@/lib/finance-guard';
import { isValidYear } from '@/lib/year-end';

const schema = z.object({ year: z.number().int(), version: z.string() });

// POST /api/year-end/:userId/confirm - 経理・人事 mark a submitted declaration as checked. `version` is the updated_at they looked at:
// if the person changed it in the meantime the answer is 409 and they have to look again.
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const actor = await yearEndActor();
  if (!actor) return forbidden();
  const { userId } = await params;
  if (await selfDealing(actor.id, userId)) return selfDealingResponse(); // nobody confirms their own declaration
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isValidYear(parsed.data.year)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { year, version } = parsed.data;

  const row = await prisma.year_end_declarations.findUnique({ where: { user_id_year: { user_id: userId, year } } });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.status !== 'submitted') return NextResponse.json({ error: 'not_submitted' }, { status: 409 });
  if (row.updated_at.toISOString() !== version) return NextResponse.json({ error: 'changed' }, { status: 409 });

  const done = await prisma.year_end_declarations.updateMany({
    where: { id: row.id, status: 'submitted', updated_at: row.updated_at },
    data: { status: 'confirmed', confirmed_at: new Date(), confirmed_by_id: actor.id },
  });
  if (done.count === 0) return NextResponse.json({ error: 'changed' }, { status: 409 });
  await logAudit({ actorUserId: actor.id, actionType: 'year_end_confirm', targetType: 'year_end_declarations', targetId: userId, metadata: { year } });
  return NextResponse.json({ ok: true });
}
