import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { isValidDateString, jstDateString } from '@/lib/work';
import { notifySettled, settleBatch } from '@/lib/transfer-settle';

const schema = z.object({ paid_date: z.string().refine(isValidDateString).optional(), note: z.string().trim().max(500).optional() });

// POST /api/transfers/batches/:id/mark-paid - the bank has executed the file: mark everything in it as paid at once.
// Payment requests become 振込済; pay statements become 支払済 (which also settles expenses merged into them).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await financeActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const batch = await prisma.transfer_batches.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const date = parsed.data.paid_date ?? jstDateString(new Date());

  const settled = batch.paid_at ? null : await settleBatch(batch, date, parsed.data.note, actor.id);
  if (!settled) return NextResponse.json({ error: 'already_paid' }, { status: 409 });

  await logAudit({
    actorUserId: actor.id, actionType: 'transfer_batch_paid', targetType: 'transfer_batches', targetId: id,
    metadata: { kind: batch.kind, count: settled.paidIds.length, total: batch.total_amount, date },
  });
  notifySettled(settled, date);
  return NextResponse.json({ ok: true, paid: settled.paidIds.length });
}
