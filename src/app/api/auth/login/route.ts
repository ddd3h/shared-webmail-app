import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { checkRateLimit, resetRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { sendDosAlert } from '@/lib/dos-alert';

// Per-IP:   20 attempts / 15 min  (broad gate against distributed brute force)
// Per-email: 5 attempts / 15 min  (per-account protection)
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const EMAIL_LIMIT = 5;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const body = await req.json().catch(() => ({}));
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // IP gate — checked before DB to avoid unnecessary load under attack
  const ipResult = checkRateLimit(`login:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!ipResult.allowed) {
    if (ipResult.isFirstBlock) sendDosAlert(ip, 'login-ip', ipResult.retryAfterSec);
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(ipResult.retryAfterSec) } }
    );
  }

  // Per-email gate — always applied regardless of whether email exists,
  // so this cannot be used to enumerate registered addresses.
  const emailKey = `login:email:${email.toLowerCase()}`;
  const emailResult = checkRateLimit(emailKey, EMAIL_LIMIT, WINDOW_MS);
  if (!emailResult.allowed) {
    await logAudit({
      actionType: 'login_rate_limited',
      targetType: 'users',
      metadata: { email, ip },
    });
    if (emailResult.isFirstBlock) {
      sendDosAlert(ip, 'login-email', emailResult.retryAfterSec, `対象メールアドレス: ${email}`);
    }
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(emailResult.retryAfterSec) } }
    );
  }

  const user = await prisma.users.findUnique({ where: { email } });

  // Intentionally identical response for "user not found" and "wrong password"
  // to prevent user-existence oracle attacks.
  const passwordOk = user?.password_hash
    ? await verifyPassword(password, user.password_hash)
    : false;

  if (!user || !passwordOk) {
    await logAudit({
      actionType: 'login_failed',
      targetType: 'users',
      metadata: { email, ip },
    });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Success: clear per-email counter so legitimate users aren't locked out
  resetRateLimit(emailKey);

  await logAudit({
    actorUserId: user.id,
    actionType: 'login_success',
    targetType: 'users',
    targetId: user.id,
    metadata: { ip },
  });

  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, { userId: user.id, email: user.email, role: user.role });
  return res;
}
