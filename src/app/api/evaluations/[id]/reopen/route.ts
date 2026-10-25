import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { evalContext } from '@/lib/eval-server';

const schema = z.object({ side: z.enum(['self', 'manager']) });

// POST /api/evaluations/:id/reopen - send a submitted form back so it can be corrected (HR), until the result is final.
// Sending the self-assessment back also reopens the manager's side, since that was written against it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx?.hr) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const ev = await prisma.evaluations.findUnique({ where: { id }, include: { cycle: { select: { status: true } } } });
  if (!ev || ev.cycle.status === 'draft') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (ev.finalized_at || ev.cycle.status !== 'open') return NextResponse.json({ error: 'locked' }, { status: 409 });
  const side = parsed.data.side;
  await prisma.evaluations.update({ where: { id }, data: side === 'self' ? { self_submitted_at: null, manager_submitted_at: null } : { manager_submitted_at: null } });
  await logAudit({ actorUserId: ctx.actor.id, actionType: 'eval_reopen', targetType: 'evaluations', targetId: id, metadata: { side } });
  return NextResponse.json({ ok: true });
}
