import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getSession, requireAuth } from '@/lib/auth';
import { fail, reauthenticate } from '@/lib/mfa-manage';
import { hasPasskey, verifyPasskeyReauth } from '@/lib/passkey-reauth';
import { checkRateLimit } from '@/lib/rate-limit';
import { recordSecurityEvent } from '@/lib/security-events';

// POST /api/auth/reauth - "prove it again". Somebody with a passkey proves it with the passkey: { passkey: { challengeId, ...the answer } } (the password
// does not log them in, so it does not count here either). Everybody else: { password, code? } - the password (and the current code, when a second factor
// is set). Either makes THIS session count as recently proved, so the high-risk actions (see lib/reauth.ts) may be done for the next few minutes.
// Wrong answers are limited (5 per 15 minutes), and noted.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const userId = session.userId;
  const byPasskey = await hasPasskey(userId);
  if (byPasskey) {
    const limit = checkRateLimit(`mfa-manage:${session.userId}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
    const body = (await req.json().catch(() => ({}))) as { passkey?: unknown; password?: unknown };
    if (!body.passkey) return fail('passkey_required', 400, 'パスキーで確認してください');
    if (!(await verifyPasskeyReauth(session.userId, body.passkey, req.headers.get('origin')))) {
      await recordSecurityEvent({ type: 'reauth_failed', severity: 'warn', detail: { reason: 'passkey' } }).catch(() => {});
      return fail('passkey_failed', 400, 'パスキーを確認できませんでした');
    }
  } else {
    const r = await reauthenticate(req, { needCode: true });
    if (r instanceof NextResponse) {
      if (r.status === 400) await recordSecurityEvent({ type: 'reauth_failed', severity: 'warn', detail: { reason: r.headers.get('x-reason') ?? 'wrong' } }).catch(() => {});
      return r;
    }
  }
  await prisma.sessions.update({ where: { id: session.sessionId }, data: { reauth_at: new Date() } });
  await logAudit({ actorUserId: userId, actionType: 'reauth_success', targetType: 'users', targetId: userId, metadata: { method: byPasskey ? 'passkey' : 'password' } });
  return NextResponse.json({ ok: true });
}
