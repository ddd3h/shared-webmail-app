import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { evalContext, openCycle } from '@/lib/eval-server';
import { notifyEvaluationOpened } from '@/lib/work-notify';

// POST /api/evaluations/cycles/:id/open - start the period: a form is made for everybody and the evaluators are assigned (HR)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx?.hr) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  // claim the period first so a double click can't open it twice
  const claimed = await prisma.eval_cycles.updateMany({ where: { id, status: 'draft' }, data: { status: 'open', opened_at: new Date() } });
  if (claimed.count === 0) return NextResponse.json({ error: (await prisma.eval_cycles.findUnique({ where: { id } })) ? 'not_draft' : 'not_found' }, { status: 409 });
  const result = await openCycle(id);
  await logAudit({ actorUserId: ctx.actor.id, actionType: 'eval_cycle_open', targetType: 'eval_cycles', targetId: id, metadata: result });
  void notifyEvaluationOpened(id);
  return NextResponse.json({ ok: true, ...result });
}
