import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { evalContext } from '@/lib/eval-server';

const schema = z.object({ force: z.boolean().default(false) });

// POST /api/evaluations/cycles/:id/close - end the period (HR). Refused while forms are not final, unless `force`.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx?.hr) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const c = await prisma.eval_cycles.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (c.status !== 'open') return NextResponse.json({ error: 'not_open' }, { status: 409 });
  const unfinished = await prisma.evaluations.count({ where: { cycle_id: id, finalized_at: null } });
  if (unfinished > 0 && !parsed.data.force) return NextResponse.json({ error: 'unfinalized', count: unfinished }, { status: 409 });
  await prisma.eval_cycles.update({ where: { id }, data: { status: 'closed', closed_at: new Date() } });
  await logAudit({ actorUserId: ctx.actor.id, actionType: 'eval_cycle_close', targetType: 'eval_cycles', targetId: id, metadata: { unfinished, force: parsed.data.force } });
  return NextResponse.json({ ok: true, unfinished });
}
