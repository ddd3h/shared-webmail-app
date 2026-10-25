import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { evalContext } from '@/lib/eval-server';
import { cycleSchema } from '@/lib/eval-input';
import { toDbDate } from '@/lib/work';

type Ctx = { params: Promise<{ id: string }> };
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/evaluations/cycles/:id - the period and its criteria (HR, or somebody taking part in it)
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const c = await prisma.eval_cycles.findUnique({ where: { id }, include: { criteria: { orderBy: { sort: 'asc' } } } });
  if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const takesPart = c.status !== 'draft' && !!(await prisma.evaluations.findFirst({ where: { cycle_id: id, OR: [{ user_id: ctx.actor.id }, { evaluator_id: ctx.actor.id }] }, select: { id: true } }));
  if (!ctx.hr && !takesPart) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({
    id: c.id, name: c.name, status: c.status, period_start: ymd(c.period_start), period_end: ymd(c.period_end),
    criteria: c.criteria.map(k => ({ id: k.id, name: k.name, description: k.description, weight: k.weight })),
  });
}

// PUT /api/evaluations/cycles/:id - change a period that has not started yet (HR). Criteria are replaced as a whole.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx?.hr) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = cycleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const c = await prisma.eval_cycles.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (c.status !== 'draft') return NextResponse.json({ error: 'not_draft' }, { status: 409 });
  const d = parsed.data;
  await prisma.$transaction([
    prisma.eval_criteria.deleteMany({ where: { cycle_id: id } }),
    prisma.eval_cycles.update({
      where: { id },
      data: { name: d.name, period_start: toDbDate(d.period_start), period_end: toDbDate(d.period_end), criteria: { create: d.criteria.map((k, sort) => ({ ...k, sort })) } },
    }),
  ]);
  await logAudit({ actorUserId: ctx.actor.id, actionType: 'eval_cycle_update', targetType: 'eval_cycles', targetId: id, metadata: { name: d.name } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/evaluations/cycles/:id - only before it has started (HR)
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx?.hr) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const c = await prisma.eval_cycles.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (c.status !== 'draft') return NextResponse.json({ error: 'not_draft' }, { status: 409 });
  await prisma.eval_cycles.delete({ where: { id } });
  await logAudit({ actorUserId: ctx.actor.id, actionType: 'eval_cycle_delete', targetType: 'eval_cycles', targetId: id, metadata: { name: c.name } });
  return NextResponse.json({ ok: true });
}
