import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';

const schema = z.object({ action: z.enum(['retry', 'skip']) });

// POST /api/freee/exports/:id - 'retry' puts a failed one back in the queue; 'skip' means it is not to be sent (entered by hand in freee, say)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await financeActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const row = await prisma.freee_exports.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.status !== 'failed') return NextResponse.json({ error: 'not_failed' }, { status: 409 }); // sent ones are never sent again
  await prisma.freee_exports.update({ where: { id }, data: parsed.data.action === 'retry' ? { status: 'pending', error: null } : { status: 'skipped', error: '送らないことにしました' } });
  await logAudit({ actorUserId: actor.id, actionType: 'freee_export_' + parsed.data.action, targetType: 'freee_exports', targetId: id });
  return NextResponse.json({ ok: true });
}
