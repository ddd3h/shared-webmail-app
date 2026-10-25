import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, refreshSessionCookie } from '@/lib/auth';
import { matchesAny } from '@/lib/cidr';
import { clientIpFrom } from '@/lib/client-ip';
import { blockIp, isIpBlocked } from '@/lib/ip-block';
import { addStrike } from '@/lib/login-guard';
import { originProblem } from '@/lib/origin-check';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { recordSecurityEvent } from '@/lib/security-events';
import { judgeAuthenticated, judgeUnauthenticated, type Verdict } from '@/lib/sweep-guard';

const PUBLIC_PATHS = ['/login', '/reset-password', '/api/auth/login', '/api/auth/logout', '/api/cron/', '/api/passkeys/auth-options', '/api/passkeys/auth'];
const isStatic = (p: string) =>
  p.startsWith('/_next') || p.startsWith('/manifest') || p.startsWith('/sw.js') ||
  p.startsWith('/icon') || // icon-192.png, icon-512.png, icon-badge.png — must be fetchable unauthenticated (push notifications fetch these in the background, without a session cookie)
  p === '/favicon.ico';
const isPublic = (p: string) => PUBLIC_PATHS.some(x => p.startsWith(x));

const AUTO_BLOCK_MINUTES = 60;

function denied(req: NextRequest, status: 403 | 429, error: string, retryAfterSec?: number): NextResponse {
  const headers = retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : undefined;
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error }, { status, headers });
  return new NextResponse(status === 429 ? 'アクセスが多すぎます。しばらくしてからもう一度お試しください。' : 'アクセスが許可されていません。', { status, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
}

/** Address-level rules, for every request: blocked addresses, allowed networks, and requests that come from another website. */
async function addressRules(req: NextRequest, ip: string): Promise<NextResponse | null> {
  if (await isIpBlocked(ip)) return denied(req, 403, 'access_denied');
  const policy = await loadSecurityPolicy();
  const cron = req.nextUrl.pathname.startsWith('/api/cron/'); // called by the scheduler with a secret, not by people
  if (!cron && policy.allowedRules.length > 0 && ip !== 'unknown' && !matchesAny(ip, policy.allowedRules)) return denied(req, 403, 'access_denied');

  const ownHosts = [req.headers.get('host'), req.headers.get('x-forwarded-host'), (() => { try { return new URL(process.env.NEXT_PUBLIC_APP_URL || '').host; } catch { return null; } })()];
  if (originProblem(req.method, req.headers.get('origin'), ownHosts)) {
    await recordSecurityEvent({ type: 'bad_origin', severity: 'warn', ip, detail: { origin: req.headers.get('origin'), path: req.nextUrl.pathname } });
    return denied(req, 403, 'bad_origin');
  }
  return null;
}

/** A request that looks like sweeping gets a 429 and, when it is a clear case, its address is blocked for a while. */
async function sweepResponse(req: NextRequest, ip: string, v: Extract<Verdict, { ok: false }>, userId?: string): Promise<NextResponse> {
  if (v.sweep) {
    await recordSecurityEvent({ type: 'sweep_detected', severity: 'alert', ip, userId, detail: { reason: v.reason, path: req.nextUrl.pathname } });
    if (v.reason === 'unauthenticated_path_scan') await blockIp({ ip, reason: '自動ブロック: ログインせずに多数のパスを探索（スキャン）', minutes: AUTO_BLOCK_MINUTES, source: 'auto' });
    else await addStrike(ip, `大量アクセス（${v.reason}）`);
  }
  return denied(req, 429, 'too_many_requests', v.retryAfterSec);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isStatic(pathname)) return NextResponse.next();

  const ip = clientIpFrom(name => req.headers.get(name));
  const refused = await addressRules(req, ip);
  if (refused) return refused;

  if (isPublic(pathname)) return NextResponse.next();

  const { session } = await getSessionFromRequest(req);
  if (!session) {
    const verdict = judgeUnauthenticated(ip, pathname);
    if (!verdict.ok) return sweepResponse(req, ip, verdict);
    const loginUrl = new URL('/login', req.url);
    if (!pathname.startsWith('/api/')) {
      loginUrl.searchParams.set('from', pathname);
    }
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete('sid'); // clear stale/expired cookie
    return res;
  }

  const verdict = judgeAuthenticated(session.userId, pathname);
  if (!verdict.ok) return sweepResponse(req, ip, verdict, session.userId);

  // Admin-only paths
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (session.role !== 'admin') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // Refresh the session cookie on every request (sliding window)
  const res = NextResponse.next();
  await refreshSessionCookie(res, session);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
