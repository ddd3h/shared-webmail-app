import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { enableTotp, forgiveTries, gateSecondFactor } from '@/lib/mfa';
import { getClientIp } from '@/lib/rate-limit';
import { recordSecurityEvent } from '@/lib/security-events';
import { unsealShort } from '@/lib/short-token';
import { notifyMfaChanged } from '@/lib/work-notify';

// POST /api/security/mfa/enable { setup_token, code } - the first code from the app: save the factor, show the recovery codes once
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const body = await req.json().catch(() => ({}));
  const note = await unsealShort<{ userId: string; secret: string; login: boolean }>('mfa-enroll', body.setup_token);
  if (!note || note.login || note.userId !== session.userId) return NextResponse.json({ error: 'challenge_expired' }, { status: 401 });
  const gate = gateSecondFactor(session.userId, getClientIp(req));
  if (!gate.ok) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, gate.retryAfterSec)) } });

  const codes = await enableTotp(session.userId, note.secret, body.code);
  if (!codes) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  forgiveTries(session.userId);
  await logAudit({ actorUserId: session.userId, actionType: 'mfa_enabled', targetType: 'users', targetId: session.userId, metadata: { via: 'profile' } });
  await recordSecurityEvent({ type: 'mfa_enabled', userId: session.userId });
  void notifyMfaChanged(session.userId, 'enabled');
  return NextResponse.json({ ok: true, recovery_codes: codes });
}
