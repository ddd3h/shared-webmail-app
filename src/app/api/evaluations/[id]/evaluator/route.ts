import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { evalContext, mayEvaluate } from '@/lib/eval-server';

const schema = z.object({ evaluator_id: z.string().min(1).nullable() });

// PUT /api/evaluations/:id/evaluator - change who evaluates this person (HR), until the result is final
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx?.hr) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const ev = await prisma.evaluations.findUnique({ where: { id }, include: { cycle: { select: { status: true } } } });
  if (!ev || ev.cycle.status === 'draft') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (ev.finalized_at || ev.cycle.status !== 'open') return NextResponse.json({ error: 'locked' }, { status: 409 });
  const next = parsed.data.evaluator_id;
  if (next && (next === ev.user_id || !(await mayEvaluate(next)))) return NextResponse.json({ error: 'invalid_evaluator' }, { status: 400 });
  await prisma.evaluations.update({ where: { id }, data: { evaluator_id: next } });
  await logAudit({ actorUserId: ctx.actor.id, actionType: 'eval_evaluator_change', targetType: 'evaluations', targetId: id, metadata: { from: ev.evaluator_id, to: next } });
  return NextResponse.json({ ok: true });
}
