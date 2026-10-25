import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { unblockIp } from '@/lib/ip-block';
import { forgetLoginHistory } from '@/lib/login-guard';
import { forgetSweep } from '@/lib/sweep-guard';

// DELETE /api/admin/security/blocks/:id - lift a block
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const b = await prisma.ip_blocks.findUnique({ where: { id } });
  if (!b) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await unblockIp(id);
  if (!b.ip.includes('/')) { forgetLoginHistory(b.ip); forgetSweep(b.ip); } // a single address starts again from zero
  await logAudit({ actorUserId: actor.id, actionType: 'ip_unblock', targetType: 'ip_blocks', targetId: id, metadata: { ip: b.ip } });
  return NextResponse.json({ ok: true });
}
