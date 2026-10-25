import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { sendDosAlert } from '@/lib/dos-alert';
import { lookupIp, type IpInfo } from '@/lib/ip-lookup';
import { DEVICE_COOKIE, isKnownDeviceFor } from '@/lib/known-device';
import { countryAllowed, finishLogin } from '@/lib/login-flow';
import { gateLogin, normalizeEmail, type Verdict } from '@/lib/login-guard';
import { logLoginAttempt } from '@/lib/login-log';
import { hashPassword, verifyPassword } from '@/lib/password';
import { getClientIp, resetRateLimit } from '@/lib/rate-limit';
import { recordSecurityEvent } from '@/lib/security-events';
import { notifyLoginLockout } from '@/lib/work-notify';

const MAX_PASSWORD_LENGTH = 1000; // scrypt on a megabyte-long "password" would be a cheap way to burn CPU

const raceTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);

// A hash to check against when the account doesn't exist, so "no such account" costs as much time as "wrong password".
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

async function passwordMatches(password: string, storedHash: string | null | undefined): Promise<boolean> {
  const ok = await verifyPassword(password, storedHash ?? (await getDummyHash()));
  return !!storedHash && ok;
}

type Attempt = { ip: string; userAgent: string; email: string };

/** A refused attempt (blocked, or too many tries): tell the caller, and tell people who need to know. */
async function refuse(a: Attempt, v: Extract<Verdict, { ok: false }>): Promise<NextResponse> {
  logLoginAttempt({ email: a.email, ipAddress: a.ip, userAgent: a.userAgent, success: false, failureReason: v.reason });
  if (v.status === 429) {
    await logAudit({ actionType: 'login_rate_limited', targetType: 'users', metadata: { email: a.email, ip: a.ip, reason: v.reason } });
    if (v.firstBlock) {
      void sendDosAlert(a.ip, v.scope === 'ip' ? 'login-ip' : 'login-email', v.retryAfterSec, v.scope === 'email' ? `対象メールアドレス: ${a.email}` : undefined);
      if (v.scope === 'email') {
        const target = await prisma.users.findFirst({ where: { email: { equals: a.email, mode: 'insensitive' } }, select: { id: true } });
        if (target) void notifyLoginLockout(target.id, a.ip);
      }
    }
  }
  const headers = v.status === 429 ? { 'Retry-After': String(Math.max(1, v.retryAfterSec)) } : undefined;
  return NextResponse.json({ error: v.error }, { status: v.status, headers });
}

/** Wrong password, unknown account, locked account, forbidden country: one and the same answer for all of them. */
async function failLogin(a: Attempt, user: { id: string } | null, reason: string, ipInfo: IpInfo | null): Promise<NextResponse> {
  await logAudit({ actionType: 'login_failed', targetType: 'users', metadata: { email: a.email, ip: a.ip, reason } });
  logLoginAttempt({
    userId: user?.id ?? null, email: a.email, ipAddress: a.ip, userAgent: a.userAgent, success: false, failureReason: reason,
    networkType: ipInfo?.networkType, orgName: ipInfo?.org, country: ipInfo?.country, city: ipInfo?.city,
  });
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const password = body.password;
  if (!email || typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const attempt: Attempt = { ip: getClientIp(req), userAgent: req.headers.get('user-agent') || '', email };
  const known = await isKnownDeviceFor(email, req.cookies.get(DEVICE_COOKIE)?.value);
  const verdict = await gateLogin({ ip: attempt.ip, email, knownDevice: known });
  if (!verdict.ok) return refuse(attempt, verdict);

  // runs while the password is being checked (scrypt takes a while)
  const lookup = lookupIp(attempt.ip);
  const user = await prisma.users.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  const passwordOk = await passwordMatches(password, user?.password_hash);
  const ipInfo = await raceTimeout(lookup, 500);

  if (!user || !passwordOk) return failLogin(attempt, user, !user ? 'user_not_found' : 'wrong_password', ipInfo);
  if (user.locked_at) return failLogin(attempt, user, 'account_locked', ipInfo);
  if (!(await countryAllowed(ipInfo))) {
    await recordSecurityEvent({ type: 'login_country_blocked', severity: 'warn', ip: attempt.ip, userId: user.id, email, detail: { country: ipInfo?.country } });
    return failLogin(attempt, user, 'country_not_allowed', ipInfo);
  }

  resetRateLimit(`login:pair:${email}|${attempt.ip}`);
  resetRateLimit(`login:email:${email}`);
  return finishLogin(req, { id: user.id, email: user.email, role: user.role }, { method: 'password', ip: attempt.ip, ipInfo });
}
