import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { lookupIp } from '@/lib/ip-lookup';
import { finishLogin } from '@/lib/login-flow';
import { addStrike, gateAddress } from '@/lib/login-guard';
import { logLoginAttempt } from '@/lib/login-log';
import { checkSecondFactor, forgiveTries, gateSecondFactor } from '@/lib/mfa';
import { getClientIp } from '@/lib/rate-limit';
import { recordSecurityEvent } from '@/lib/security-events';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { unsealShort } from '@/lib/short-token';
import { notifyRecoveryCodeUsed } from '@/lib/work-notify';

// POST /api/auth/mfa/verify { challenge, code, trust_device? } — the second step of a password login.
// `code` is the 6 digits from the authenticator app, or a recovery code. Only here does the session get created.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || '';
  const address = await gateAddress(ip);
  if (!address.ok) return NextResponse.json({ error: address.error }, { status: address.status });

  const body = await req.json().catch(() => ({}));
  const note = await unsealShort<{ userId: string }>('mfa-login', body.challenge);
  if (!note) return NextResponse.json({ error: 'challenge_expired' }, { status: 401 });

  const gate = gateSecondFactor(note.userId, ip);
  if (!gate.ok) {
    if (gate.firstBlock) { await recordSecurityEvent({ type: 'mfa_locked', severity: 'alert', ip, userId: note.userId }); void addStrike(ip, '2段階認証のコードを何度も間違えました'); }
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, gate.retryAfterSec)) } });
  }

  const user = await prisma.users.findUnique({ where: { id: note.userId } });
  if (!user || user.locked_at) return NextResponse.json({ error: 'challenge_expired' }, { status: 401 });

  const result = await checkSecondFactor(user.id, body.code);
  if (!result.ok) {
    await logAudit({ actionType: 'login_failed', targetType: 'users', targetId: user.id, metadata: { email: user.email, ip, reason: 'wrong_2fa' } });
    logLoginAttempt({ userId: user.id, email: user.email, ipAddress: ip, userAgent, success: false, failureReason: 'wrong_2fa' });
    return NextResponse.json({ error: 'invalid_code' }, { status: 401 });
  }

  forgiveTries(user.id);
  if (result.method === 'recovery') {
    await recordSecurityEvent({ type: 'mfa_recovery_used', severity: 'warn', ip, userId: user.id, email: user.email });
    void notifyRecoveryCodeUsed(user.id, ip);
  }
  const policy = await loadSecurityPolicy();
  const trustMfaDays = body.trust_device === true && result.method === 'totp' ? policy.mfaTrustDays : 0; // a recovery code never makes a browser trusted
  return finishLogin(req, { id: user.id, email: user.email, role: user.role }, { method: 'password', ip, ipInfo: await lookupIp(ip), trustMfaDays });
}
