import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { checkRateLimit, resetRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { sendDosAlert } from '@/lib/dos-alert';
import { lookupIp } from '@/lib/ip-lookup';
import { logLoginAttempt } from '@/lib/login-log';

// Per-IP:   20 attempts / 15 min  (broad gate against distributed brute force)
// Per-email: 5 attempts / 15 min  (per-account protection)
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const EMAIL_LIMIT = 5;

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || '';
  const body = await req.json().catch(() => ({}));
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // IP gate — checked before DB to avoid unnecessary load under attack
  const ipResult = checkRateLimit(`login:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!ipResult.allowed) {
    if (ipResult.isFirstBlock) sendDosAlert(ip, 'login-ip', ipResult.retryAfterSec);
    logLoginAttempt({ email, ipAddress: ip, userAgent, success: false, failureReason: 'rate_limited' });
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
    logLoginAttempt({ email, ipAddress: ip, userAgent, success: false, failureReason: 'rate_limited' });
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(ipResult.retryAfterSec) } }
    );
  }

  // Fire IP lookup in parallel with DB + password ops.
  // argon2 verification takes 100-300ms; ip-api.com typically responds in <100ms.
  const ipLookupPromise = lookupIp(ip);

  const user = await prisma.users.findUnique({ where: { email } });

  // Intentionally identical response for "user not found" and "wrong password"
  // to prevent user-existence oracle attacks.
  const passwordOk = user?.password_hash
    ? await verifyPassword(password, user.password_hash)
    : false;

  if (!user || !passwordOk) {
    const failureReason = !user ? 'user_not_found' : 'wrong_password';
    const ipInfo = await raceTimeout(ipLookupPromise, 500);

    await logAudit({
      actionType: 'login_failed',
      targetType: 'users',
      metadata: { email, ip },
    });
    logLoginAttempt({
      userId: user?.id ?? null,
      email,
      ipAddress: ip,
      userAgent,
      success: false,
      failureReason,
      networkType: ipInfo?.networkType ?? null,
      orgName: ipInfo?.org ?? null,
      country: ipInfo?.country ?? null,
      city: ipInfo?.city ?? null,
    });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Success: clear per-email counter so legitimate users aren't locked out
  resetRateLimit(emailKey);

  // Wait for IP info (nearly instant since it ran during password verification)
  const ipInfo = await raceTimeout(ipLookupPromise, 500);
  const networkType = ipInfo?.networkType ?? 'residential';

  // Record login timestamp (fire-and-forget — don't block the response)
  prisma.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } }).catch(() => {});

  await logAudit({
    actorUserId: user.id,
    actionType: 'login_success',
    targetType: 'users',
    targetId: user.id,
    metadata: { ip, networkType },
  });

  logLoginAttempt({
    userId: user.id,
    email: user.email,
    ipAddress: ip,
    userAgent,
    success: true,
    networkType,
    orgName: ipInfo?.org ?? null,
    country: ipInfo?.country ?? null,
    city: ipInfo?.city ?? null,
  });

  const res = NextResponse.json({ ok: true });
  await setSessionCookie(
    res,
    { userId: user.id, email: user.email, role: user.role },
    { ip, userAgent, networkType }
  );
  return res;
}
