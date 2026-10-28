import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth, revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { serializeSession } from '@/lib/security-view';

// GET /api/security/sessions - where I am logged in right now
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const rows = await prisma.sessions.findMany({ where: { user_id: session.userId, expires_at: { gt: new Date() } }, orderBy: { last_activity_at: 'desc' } });
  return NextResponse.json({ items: rows.map(r => serializeSession(r, session.sessionId)) });
}

// DELETE /api/security/sessions - log out everywhere else ("心当たりのない端末があるとき")
export async function DELETE() {
  const session = await getSession();
  requireAuth(session);
  const ended = await revokeUserSessions(session.userId, session.sessionId);
  await logAudit({ actorUserId: session.userId, actionType: 'sessions_revoke_others', targetType: 'sessions', metadata: { ended } });
  return NextResponse.json({ ok: true, ended });
}
