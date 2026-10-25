import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { evalContext } from '@/lib/eval-server';
import { cycleSchema } from '@/lib/eval-input';
import { toDbDate } from '@/lib/work';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/evaluations/cycles - HR sees every period; everybody else only the started ones they take part in
export async function GET() {
  const ctx = await evalContext();
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const me = ctx.actor.id;
  const rows = await prisma.eval_cycles.findMany({
    where: ctx.hr ? {} : { status: { not: 'draft' }, evaluations: { some: { OR: [{ user_id: me }, { evaluator_id: me }] } } },
    orderBy: { period_start: 'desc' },
    include: { _count: { select: { criteria: true, evaluations: true } }, evaluations: { select: { self_submitted_at: true, manager_submitted_at: true, finalized_at: true } } },
  });
  return NextResponse.json({
    items: rows.map(c => ({
      id: c.id, name: c.name, status: c.status, period_start: ymd(c.period_start), period_end: ymd(c.period_end), criteria_count: c._count.criteria,
      ...(ctx.hr ? { progress: { total: c._count.evaluations, self: c.evaluations.filter(e => e.self_submitted_at).length, manager: c.evaluations.filter(e => e.manager_submitted_at).length, finalized: c.evaluations.filter(e => e.finalized_at).length } } : {}),
    })),
  });
}

// POST /api/evaluations/cycles - prepare a period with its criteria (HR)
export async function POST(req: NextRequest) {
  const ctx = await evalContext();
  if (!ctx?.hr) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = cycleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const cycle = await prisma.eval_cycles.create({
    data: {
      name: d.name, period_start: toDbDate(d.period_start), period_end: toDbDate(d.period_end), created_by_id: ctx.actor.id,
      criteria: { create: d.criteria.map((c, sort) => ({ ...c, sort })) },
    },
  });
  await logAudit({ actorUserId: ctx.actor.id, actionType: 'eval_cycle_create', targetType: 'eval_cycles', targetId: cycle.id, metadata: { name: cycle.name } });
  return NextResponse.json({ id: cycle.id }, { status: 201 });
}
