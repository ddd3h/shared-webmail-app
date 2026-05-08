import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import * as Iron from 'iron-webcrypto';

const SESSION_COOKIE = 'sid';
const secretRaw = process.env.SESSION_SECRET || 'dev-secret-at-least-32-chars-long!!';
const password = { id: '1', secret: secretRaw };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cryptoImpl: any = globalThis.crypto;

const INACTIVITY_MS = 4 * 60 * 60 * 1000; // 4 hours

const isHttps = (process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://');

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: INACTIVITY_MS / 1000, // cookie max-age matches inactivity window
  ...(isHttps ? { secure: true } : {}),
};

export type Session = {
  userId: string;
  email: string;
  role: string;
  lastActivity: number; // epoch ms
};

async function sealSession(session: Session): Promise<string> {
  return Iron.seal(cryptoImpl, session, password, { ...Iron.defaults, ttl: 0 }) as Promise<string>;
}

async function unsealToken(token: string): Promise<Session | null> {
  try {
    const data = await Iron.unseal(cryptoImpl, token, { '1': password }, { ...Iron.defaults, ttl: 0 });
    return data as Session;
  } catch {
    return null;
  }
}

function isExpired(session: Session): boolean {
  return Date.now() - (session.lastActivity || 0) > INACTIVITY_MS;
}

// For Route Handlers and Server Components (uses next/headers cookies)
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await unsealToken(token);
  if (!session) return null;
  if (isExpired(session)) return null;
  return session;
}

// For middleware (reads from NextRequest directly - Edge compatible)
// Also refreshes the session cookie (sliding window)
export async function getSessionFromRequest(req: NextRequest): Promise<{ session: Session | null; token: string | null }> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return { session: null, token: null };
  const session = await unsealToken(token);
  if (!session) return { session: null, token: null };
  if (isExpired(session)) return { session: null, token: null };
  return { session, token };
}

// Re-seal with fresh lastActivity and set cookie on response (sliding window)
export async function refreshSessionCookie(res: NextResponse, session: Session): Promise<void> {
  const refreshed: Session = { ...session, lastActivity: Date.now() };
  const newToken = await sealSession(refreshed);
  res.cookies.set(SESSION_COOKIE, newToken, COOKIE_OPTIONS);
}

// Set session cookie on login
export async function setSessionCookie(res: NextResponse, data: { userId: string; email: string; role: string }) {
  const session: Session = { ...data, lastActivity: Date.now() };
  const token = await sealSession(session);
  res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
}

export function requireAuth(session: Session | null): asserts session is Session {
  if (!session) {
    const e: any = new Error('Unauthorized');
    e.status = 401;
    throw e;
  }
}
