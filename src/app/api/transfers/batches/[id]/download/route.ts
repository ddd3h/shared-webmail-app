import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';

// GET /api/transfers/batches/:id/download - the exact file that was generated (finance staff only; every download is logged)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await financeActor();
  if (!actor) return forbidden();
  const b = await prisma.transfer_batches.findUnique({ where: { id } });
  if (!b) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await logAudit({ actorUserId: actor.id, actionType: 'transfer_batch_download', targetType: 'transfer_batches', targetId: id, metadata: { file: b.file_name, count: b.item_count, total: b.total_amount } });
  const bytes = Buffer.from(b.content_b64, 'base64');
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${b.file_name}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
