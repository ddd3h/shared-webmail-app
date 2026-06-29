import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import * as Iron from 'iron-webcrypto';
import { prisma } from '@/lib/db';

const SESSION_COOKIE = 'sid';
const secretRaw = process.env.SESSION_SECRET || 'dev-secret-at-least-32-chars-long!!';
const password = { id: '1', secret: secretRaw };

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
  expiresAt: number; // epoch ms
};

// Public type exposed to callers
export type Session = {
  sessionId: string;
  userId: string;
  email: string;
  role: string;
  networkType: string;
  expiresAt: number;
};

async function sealSession(payload: SealedPayload): Promise<string> {
  return Iron.seal(cryptoImpl, payload, password, { ...Iron.defaults, ttl: 0 }) as Promise<string>;
}

async function unsealToken(token: string): Promise<SealedPayload | null> {
  try {
    const data = await Iron.unseal(cryptoImpl, token, { '1': password }, { ...Iron.defaults, ttl: 0 });
    return data as SealedPayload;
  } catch {
    return null;
  }
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

  // DB check: verify session still exists (handles user deletion, manual revocation)
  const dbSession = await prisma.sessions.findUnique({
    where: { id: payload.sessionId },
    select: { id: true, expires_at: true },
  });
  if (!dbSession) return null;
  if (dbSession.expires_at < new Date()) {
    prisma.sessions.delete({ where: { id: payload.sessionId } }).catch(() => {});
    return null;
  }

  return {
    sessionId: payload.sessionId,
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    networkType: payload.networkType,
    expiresAt: payload.expiresAt,
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

// Set session cookie on login — creates DB session record
export async function setSessionCookie(
  res: NextResponse,
  data: { userId: string; email: string; role: string },
  context: { ip: string; userAgent: string; networkType: string }
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
      expires_at: new Date(expiresAt),
    },
  });

  const payload: SealedPayload = {
    sessionId,
    userId: data.userId,
    email: data.email,
    role: data.role,
    networkType: context.networkType,
    expiresAt,
  };

  const token = await sealSession(payload);
  res.cookies.set(SESSION_COOKIE, token, getCookieOptions(context.networkType));
}

// Delete DB session on logout
export async function clearSession(sessionId: string): Promise<void> {
  await prisma.sessions.delete({ where: { id: sessionId } }).catch(() => {});
}

export function requireAuth(session: Session | null): asserts session is Session {
  if (!session) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e: any = new Error('Unauthorized');
    e.status = 401;
    throw e;
  }
}
