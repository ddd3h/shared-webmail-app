import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { lookupIp } from '@/lib/ip-lookup';
import { finishLogin } from '@/lib/login-flow';
import { gateAddress } from '@/lib/login-guard';
import { enableTotp, forgiveTries, gateSecondFactor, hasTotp } from '@/lib/mfa';
import { getClientIp } from '@/lib/rate-limit';
import { recordSecurityEvent } from '@/lib/security-events';
import { unsealShort } from '@/lib/short-token';

// POST /api/auth/mfa/enable { setup_token, code } — the person typed the first code from their app: save it, and finish the login.
// The response carries the recovery codes; this is the only time they are shown.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const address = await gateAddress(ip);
  if (!address.ok) return NextResponse.json({ error: address.error }, { status: address.status });
  const body = await req.json().catch(() => ({}));
  const note = await unsealShort<{ userId: string; secret: string; login: boolean }>('mfa-enroll', body.setup_token);
  if (!note?.login) return NextResponse.json({ error: 'challenge_expired' }, { status: 401 });

  const gate = gateSecondFactor(note.userId, ip);
  if (!gate.ok) return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, gate.retryAfterSec)) } });
  const user = await prisma.users.findUnique({ where: { id: note.userId } });
  if (!user || user.locked_at || hasTotp(user)) return NextResponse.json({ error: 'challenge_expired' }, { status: 401 });

  const codes = await enableTotp(user.id, note.secret, body.code);
  if (!codes) return NextResponse.json({ error: 'invalid_code' }, { status: 401 });

  forgiveTries(user.id);
  await logAudit({ actorUserId: user.id, actionType: 'mfa_enabled', targetType: 'users', targetId: user.id, metadata: { via: 'login' } });
  await recordSecurityEvent({ type: 'mfa_enabled', severity: 'info', ip, userId: user.id, email: user.email });
  return finishLogin(req, { id: user.id, email: user.email, role: user.role }, { method: 'password', ip, ipInfo: await lookupIp(ip), extra: { recovery_codes: codes } });
}
