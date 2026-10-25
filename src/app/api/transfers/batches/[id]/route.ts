import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';

// DELETE /api/transfers/batches/:id - throw away a file that was never used (not yet marked paid).
// The requests / statements in it become available for a new file again.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const b = await prisma.transfer_batches.findUnique({ where: { id } });
  if (!b) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (b.paid_at) return NextResponse.json({ error: 'already_paid' }, { status: 409 });
  await prisma.transfer_batches.delete({ where: { id } }); // items' batch_id is set to NULL by the FK
  await logAudit({ actorUserId: actor.id, actionType: 'transfer_batch_cancel', targetType: 'transfer_batches', targetId: id, metadata: { file: b.file_name, count: b.item_count } });
  return NextResponse.json({ ok: true });
}
