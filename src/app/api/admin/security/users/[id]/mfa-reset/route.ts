import { NextRequest, NextResponse } from 'next/server';
import { revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { clearTotp } from '@/lib/mfa';
import { recordSecurityEvent } from '@/lib/security-events';
import { notifyMfaChanged } from '@/lib/work-notify';

// POST /api/admin/security/users/:id/mfa-reset - the person lost their phone and their recovery codes.
// Removes the factor, ends their sessions, and tells them; their next password login sets it up again.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminActor();
  if (!actor) return forbidden();
  const target = await prisma.users.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await clearTotp(id);
  const ended = await revokeUserSessions(id);
  await logAudit({ actorUserId: actor.id, actionType: 'mfa_reset', targetType: 'users', targetId: id, metadata: { sessions_ended: ended } });
  await recordSecurityEvent({ type: 'mfa_reset', severity: 'warn', userId: id, email: target.email, detail: { by: actor.id } });
  void notifyMfaChanged(id, 'reset');
  return NextResponse.json({ ok: true, ended });
}
