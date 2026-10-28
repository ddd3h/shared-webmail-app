// Changing the second factor of an account that is already logged in: first the person must prove it is really them
// (current password, plus a current code once a factor exists), because a stolen session must not be able to switch it off.
import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth, type Session } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { checkSecondFactor, hasTotp } from '@/lib/mfa';
import { verifyPassword } from '@/lib/password';
import { checkRateLimit } from '@/lib/rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
export const fail = (error: string, status: number, message?: string) => NextResponse.json({ error, message }, { status });

type Ok = { session: Session; user: NonNullable<Awaited<ReturnType<typeof loadUser>>>; body: Record<string, unknown> };
const loadUser = (id: string) => prisma.users.findUnique({ where: { id } });

/** Signed in, within the try limit, password correct (and `needCode`: a correct current code too). */
export async function reauthenticate(req: NextRequest, o: { needCode: boolean }): Promise<Ok | NextResponse> {
  const session = await getSession();
  requireAuth(session);
  const limit = checkRateLimit(`mfa-manage:${session.userId}`, 5, WINDOW_MS);
  if (!limit.allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const user = await loadUser(session.userId);
  if (!user?.password_hash || typeof body.password !== 'string' || !(await verifyPassword(body.password, user.password_hash))) return fail('wrong_password', 400, 'パスワードが違います');
  if (o.needCode && hasTotp(user) && !(await checkSecondFactor(user.id, body.code)).ok) return fail('invalid_code', 400, '認証コードが違います');
  return { session, user, body };
}
