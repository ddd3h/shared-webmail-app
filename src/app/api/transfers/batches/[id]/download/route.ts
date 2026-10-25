import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';

// GET /api/transfers/batches/:id/download - the exact file that was generated (finance staff only; every download is logged)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const b = await prisma.transfer_batches.findUnique({ where: { id } });
  if (!b) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await logAudit({ actorUserId: actor.id, actionType: 'transfer_batch_download', targetType: 'transfer_batches', targetId: id, metadata: { file: b.file_name, count: b.item_count, total: b.total_amount } });
  return new NextResponse(Buffer.from(b.content_b64, 'base64'), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${b.file_name}"`,
      'Content-Length': String(Buffer.from(b.content_b64, 'base64').length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
