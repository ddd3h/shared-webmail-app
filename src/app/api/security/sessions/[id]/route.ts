import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

// DELETE /api/security/sessions/:id - end one of MY sessions (somebody else's id is simply "not found")
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const r = await prisma.sessions.deleteMany({ where: { id, user_id: session.userId } });
  if (r.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await logAudit({ actorUserId: session.userId, actionType: 'session_revoke', targetType: 'sessions', targetId: id, metadata: { current: id === session.sessionId } });
  return NextResponse.json({ ok: true });
}
