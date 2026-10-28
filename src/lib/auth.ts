import { cookies, headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import * as Iron from 'iron-webcrypto';
import { prisma } from '@/lib/db';
import { clientIpFrom, sameNetwork } from '@/lib/client-ip';
import { deviceFingerprint } from '@/lib/device';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { recordSecurityEvent } from '@/lib/security-events';

const SESSION_COOKIE = 'sid';
const DEV_SECRET = 'dev-secret-at-least-32-chars-long!!';

// The key that seals session cookies. Falling back to a published development key in production would let anybody
// forge a cookie, so there it must be set properly; the check runs on first use (not at import, so builds without env still work).
export function sessionPassword() {
  const secret = process.env.SESSION_SECRET || DEV_SECRET;
  if (process.env.NODE_ENV === 'production' && (secret === DEV_SECRET || secret.length < 32 || secret.startsWith('CHANGE_ME'))) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters in production');
  }
  return { id: '1', secret };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cryptoImpl: any = globalThis.crypto;

const TIMEOUT_MS: Record<string, number> = {
  public:      30 * 60 * 1000,
  semi_public: 60 * 60 * 1000,
  hosting:     60 * 60 * 1000,
  residential: 12 * 60 * 60 * 1000,
};

function getTimeoutMs(networkType: string): number {
  return TIMEOUT_MS[networkType] ?? TIMEOUT_MS.residential;
}

const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  if (!appUrl.startsWith('https://')) {
    console.error(
      '[auth] NEXT_PUBLIC_APP_URL must start with https:// in production (got: %s). ' +
      'Cookies will still be Secure, but fix the URL to avoid other issues.',
      appUrl || '(unset)'
    );
  }
}

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: isProd,
};

function getCookieOptions(networkType: string) {
  return { ...BASE_COOKIE_OPTIONS, maxAge: getTimeoutMs(networkType) / 1000 };
}

// Internal sealed payload — stored in the cookie
type SealedPayload = {
  sessionId: string;
  userId: string;
  email: string;
  role: string;
  networkType: string;
  expiresAt: number; // epoch ms (idle timeout: pushed forward on every request)
  issuedAt?: number; // epoch ms of the login: a session never outlives SECURITY_SESSION_MAX_DAYS, however active
  fp?: string;       // browser + OS of the login (no versions): a cookie replayed from another kind of device is refused
  ip?: string;       // the address of the login: a session is only good from the address it began on
  resumed?: boolean; // made by the installed app's key (no password was typed): sensitive changes ask for a real login first
};

// Public type exposed to callers
export type Session = {
  sessionId: string;
  userId: string;
  email: string;
  role: string;
  networkType: string;
  expiresAt: number;
  issuedAt?: number;
  fp?: string;
  ip?: string;
  resumed?: boolean;
};

async function sealSession(payload: SealedPayload): Promise<string> {
  return Iron.seal(cryptoImpl, payload, sessionPassword(), { ...Iron.defaults, ttl: 0 }) as Promise<string>;
}

async function unsealToken(token: string): Promise<SealedPayload | null> {
  try {
    const data = await Iron.unseal(cryptoImpl, token, { '1': sessionPassword() }, { ...Iron.defaults, ttl: 0 });
    return data as SealedPayload;
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 3600 * 1000;
export const IDLE_GRACE_MINUTES = 1;

/** Ends a session and leaves a note (used when a cookie fails one of the extra checks). */
export async function revokeSuspicious(sessionId: string, userId: string, type: string, detail: Record<string, unknown>): Promise<null> {
  await prisma.sessions.delete({ where: { id: sessionId } }).catch(() => {});
  await recordSecurityEvent({ type, severity: 'warn', userId, detail });
  return null;
}

// For Route Handlers and Server Components (uses next/headers cookies)
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await unsealToken(token);
  if (!payload) return null;
  if (!payload.sessionId || !payload.userId) return null; // old-format token guard
  if (Date.now() > payload.expiresAt) return null;

  // DB check: the session must still exist (revoked, user deleted) and the account must still be allowed in.
  // The role comes from the DB, not the cookie, so a demotion or lock takes effect at once.
  // one query: the session and its user (role, lock) together
  const dbSession = await prisma.sessions.findUnique({
    where: { id: payload.sessionId },
    relationLoadStrategy: 'join',
    select: { id: true, expires_at: true, created_at: true, ip_address: true, last_input_at: true, user: { select: { role: true, locked_at: true } } },
  });
  if (!dbSession) return null;
  const hdrs = await headers();
  if (dbSession.expires_at < new Date()) {
    prisma.sessions.delete({ where: { id: payload.sessionId } }).catch(() => {});
    return null;
  }
  if (dbSession.user.locked_at) return revokeSuspicious(payload.sessionId, payload.userId, 'session_locked_account', {});

  // A login belongs to the address it began on. From any other address the session is ended, not just refused,
  // so a stolen cookie is dead for good (and the real person simply logs in again).
  const ip = clientIpFrom(name => hdrs.get(name));
  if (!sameNetwork(ip, dbSession.ip_address)) return revokeSuspicious(payload.sessionId, payload.userId, 'session_ip_mismatch', { expected: dbSession.ip_address, got: ip });

  const policy = await loadSecurityPolicy();
  const issuedAt = payload.issuedAt ?? dbSession.created_at.getTime();
  if (Date.now() - issuedAt > policy.sessionMaxDays * DAY_MS) return revokeSuspicious(payload.sessionId, payload.userId, 'session_max_age', { days: policy.sessionMaxDays });

  // No input for too long: the session ends, quietly (nothing suspicious happened). The page sends a sign of life while the person works;
  // background requests (polling) do not count. A minute of grace covers the page's own throttling.
  if (policy.idleMinutes > 0 && Date.now() - dbSession.last_input_at.getTime() > (policy.idleMinutes + IDLE_GRACE_MINUTES) * 60_000) {
    await prisma.sessions.delete({ where: { id: payload.sessionId } }).catch(() => {});
    return null;
  }

  if (payload.fp && policy.deviceBinding) {
    const now = deviceFingerprint(hdrs.get('user-agent'));
    if (now !== payload.fp) return revokeSuspicious(payload.sessionId, payload.userId, 'session_device_mismatch', { expected: payload.fp, got: now });
  }

  return {
    sessionId: payload.sessionId,
    userId: payload.userId,
    email: payload.email,
    role: dbSession.user.role,
    networkType: payload.networkType,
    expiresAt: payload.expiresAt,
    issuedAt,
    fp: payload.fp,
    ip: dbSession.ip_address,
    resumed: payload.resumed,
  };
}

// For middleware (Edge-compatible — no DB)
export async function getSessionFromRequest(req: NextRequest): Promise<{ session: Session | null; token: string | null }> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return { session: null, token: null };

  const payload = await unsealToken(token);
  if (!payload) return { session: null, token: null };
  if (!payload.sessionId || !payload.userId) return { session: null, token: null };
  if (Date.now() > payload.expiresAt) return { session: null, token: null };

  return {
    session: {
      sessionId: payload.sessionId,
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      networkType: payload.networkType,
      expiresAt: payload.expiresAt,
      issuedAt: payload.issuedAt,
      fp: payload.fp,
      ip: payload.ip,
      resumed: payload.resumed,
    },
    token,
  };
}

// Sliding window — re-seal with new expiresAt and update DB (throttled)
export async function refreshSessionCookie(res: NextResponse, session: Session): Promise<void> {
  const newExpiresAt = Date.now() + getTimeoutMs(session.networkType);
  const newPayload: SealedPayload = { ...session, expiresAt: newExpiresAt };
  const newToken = await sealSession(newPayload);
  res.cookies.set(SESSION_COOKIE, newToken, getCookieOptions(session.networkType));

  // Throttle DB writes to at most once per minute
  const THROTTLE_MS = 60_000;
  const sessionAge = Date.now() - (session.expiresAt - getTimeoutMs(session.networkType));
  if (sessionAge > THROTTLE_MS) {
    prisma.sessions.update({
      where: { id: session.sessionId },
      data: { expires_at: new Date(newExpiresAt), last_activity_at: new Date() },
    }).catch(() => {});
  }
}

// A person can be logged in on at most this many devices; the least recently used ones are ended when they log in on another.
export const MAX_SESSIONS_PER_USER = 10;
async function trimOldSessions(userId: string): Promise<void> {
  const keep = await prisma.sessions.findMany({ where: { user_id: userId }, orderBy: { last_activity_at: 'desc' }, take: MAX_SESSIONS_PER_USER, select: { id: true } });
  if (keep.length >= MAX_SESSIONS_PER_USER) await prisma.sessions.deleteMany({ where: { user_id: userId, id: { notIn: keep.map(k => k.id) } } });
}

// Set session cookie on login — creates DB session record
export async function setSessionCookie(
  res: NextResponse,
  data: { userId: string; email: string; role: string },
  context: { ip: string; userAgent: string; networkType: string; country?: string | null; city?: string | null; deviceId?: string | null; resumed?: boolean }
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + getTimeoutMs(context.networkType);

  await prisma.sessions.create({
    data: {
      id: sessionId,
      user_id: data.userId,
      ip_address: context.ip,
      user_agent: context.userAgent || null,
      network_type: context.networkType,
      country: context.country ?? null,
      city: context.city ?? null,
      device_id: context.deviceId ?? null,
      expires_at: new Date(expiresAt),
    },
  });

  await trimOldSessions(data.userId);

  const payload: SealedPayload = {
    sessionId,
    userId: data.userId,
    email: data.email,
    role: data.role,
    networkType: context.networkType,
    expiresAt,
    issuedAt: Date.now(),
    fp: deviceFingerprint(context.userAgent),
    ip: context.ip,
    ...(context.resumed ? { resumed: true } : {}),
  };

  const token = await sealSession(payload);
  res.cookies.set(SESSION_COOKIE, token, getCookieOptions(context.networkType));
}

// Delete DB session on logout
export async function clearSession(sessionId: string): Promise<void> {
  await prisma.sessions.delete({ where: { id: sessionId } }).catch(() => {});
}

/** Ends every session of a person (after a password change, a lock, ...), optionally keeping the one in use. */
export async function revokeUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const r = await prisma.sessions.deleteMany({ where: { user_id: userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
  // the reasons for ending sessions (password changed, account locked, ...) are also reasons to stop trusting browsers for 2FA
  await prisma.known_devices.updateMany({ where: { user_id: userId, mfa_trusted_until: { not: null } }, data: { mfa_trusted_until: null } });
  // and every installed app that could log in again without a password
  await prisma.known_devices.updateMany({ where: { user_id: userId, remember_until: { not: null } }, data: { remember_until: null, public_key: null } });
  return r.count;
}

/**
 * A session made by the installed app's device key (no password typed) may read and work, but not change who can get in:
 * password, 2-step login, passkeys, bank account. Returns the refusal to send, or null when it is a real login.
 */
export function freshLoginRequired(session: Session): NextResponse | null {
  if (!session.resumed) return null;
  return NextResponse.json({ error: 'reauth_required', message: 'この操作は、パスワードまたはパスキーでログインし直してから行ってください（アプリの自動ログインでは行えません）' }, { status: 403 });
}

export function requireAuth(session: Session | null): asserts session is Session {
  if (!session) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e: any = new Error('Unauthorized');
    e.status = 401;
    throw e;
  }
}
