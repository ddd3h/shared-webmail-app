import { NextRequest, NextResponse } from 'next/server';
import { revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { adminActor, forbidden } from '@/lib/finance-guard';

// DELETE /api/admin/security/sessions?userId= - log a person out of every device
export async function DELETE(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const ended = await revokeUserSessions(userId);
  await logAudit({ actorUserId: actor.id, actionType: 'sessions_revoke_all', targetType: 'users', targetId: userId, metadata: { ended } });
  return NextResponse.json({ ok: true, ended });
}
