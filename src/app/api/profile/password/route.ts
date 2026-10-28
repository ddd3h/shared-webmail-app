import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth, revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/password';
import { passwordProblem } from '@/lib/password-policy';
import { checkRateLimit } from '@/lib/rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;

// POST /api/profile/password  { currentPassword, newPassword }
// The current password is asked again (somebody at an unlocked screen must not be able to take the account over),
// the number of tries is limited, and every other session of the person is ended afterwards.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const limit = checkRateLimit(`pwchange:${session.userId}`, MAX_TRIES, WINDOW_MS);
  if (!limit.allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });

  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const user = await prisma.users.findUnique({ where: { id: session.userId } });
  if (!user?.password_hash) return NextResponse.json({ error: 'no_password' }, { status: 400 });
  if (!(await verifyPassword(currentPassword, user.password_hash))) return NextResponse.json({ error: 'wrong_current_password' }, { status: 400 });

  const problem = passwordProblem(newPassword, { email: user.email, name: user.name });
  if (problem) return NextResponse.json({ error: 'password_weak', message: problem }, { status: 400 });
  if (await verifyPassword(newPassword, user.password_hash)) return NextResponse.json({ error: 'password_same', message: '今のパスワードと同じです' }, { status: 400 });

  await prisma.users.update({ where: { id: session.userId }, data: { password_hash: await hashPassword(newPassword) } });
  const ended = await revokeUserSessions(session.userId, session.sessionId);
  await logAudit({ actorUserId: session.userId, actionType: 'password_change', targetType: 'users', targetId: session.userId, metadata: { sessions_ended: ended } });
  return NextResponse.json({ ok: true, sessions_ended: ended });
}
