import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { evalContext, stageOf } from '@/lib/eval-server';

type Scope = 'mine' | 'team' | 'all';

// GET /api/evaluations?scope=mine|team|all&cycle_id=
//   mine = forms about me, team = forms I am the evaluator of, all = everybody's (HR only).
// Rows hold progress only; the scores are in /api/evaluations/:id, where visibility rules are applied.
export async function GET(req: NextRequest) {
  const ctx = await evalContext();
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const scope = (sp.get('scope') ?? 'mine') as Scope;
  if (!['mine', 'team', 'all'].includes(scope)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  if (scope === 'all' && !ctx.hr) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const who = scope === 'mine' ? { user_id: ctx.actor.id } : scope === 'team' ? { evaluator_id: ctx.actor.id } : {};
  const rows = await prisma.evaluations.findMany({
    where: { ...who, cycle: { status: { not: 'draft' } }, ...(sp.get('cycle_id') ? { cycle_id: sp.get('cycle_id')! } : {}) },
    orderBy: [{ cycle: { period_start: 'desc' } }, { user: { name: 'asc' } }],
    include: { cycle: { select: { id: true, name: true, status: true } }, user: { select: { id: true, name: true } }, evaluator: { select: { id: true, name: true } } },
    take: 500,
  });
  return NextResponse.json({
    items: rows.map(e => ({
      id: e.id, cycle: e.cycle, user: e.user, evaluator: e.evaluator, stage: stageOf(e),
      // the result is only shown once final (HR always sees it)
      grade: e.finalized_at || (scope === 'all' && ctx.hr) ? e.grade : null, score: e.finalized_at || (scope === 'all' && ctx.hr) ? e.score : null,
    })),
  });
}
