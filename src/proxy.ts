import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, refreshSessionCookie, verifyRequestSession, type Moved, type Session } from '@/lib/auth';
import { addPendingAddress } from '@/lib/address-confirm';
import { matchesAny } from '@/lib/cidr';
import { clientIpFrom } from '@/lib/client-ip';
import { blockIp, isIpBlocked } from '@/lib/ip-block';
import { addStrike } from '@/lib/login-guard';
import { originProblem } from '@/lib/origin-check';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { recordSecurityEvent } from '@/lib/security-events';
import { BOT_KIND_LABEL, botAllowList, botBlockForcedOff, botKind } from '@/lib/bot-guard';
import { isLockedDown, noteShutOut } from '@/lib/lockdown';
import { judgeAuthenticated, judgeUnauthenticated, type Verdict } from '@/lib/sweep-guard';

const PUBLIC_PATHS = ['/login', '/reset-password', '/api/auth/login', '/api/auth/mfa/', '/api/auth/logout', '/api/auth/resume', '/api/cron/', '/api/passkeys/auth-options', '/api/passkeys/auth'];
const isStatic = (p: string) =>
  p.startsWith('/_next') || p.startsWith('/manifest') || p.startsWith('/sw.js') ||
  p.startsWith('/icon') || // icon-192.png, icon-512.png, icon-badge.png — must be fetchable unauthenticated (push notifications fetch these in the background, without a session cookie)
  p === '/favicon.ico' ||
  p === '/robots.txt'; // answered to robots too: a 403 here would read as "nothing is forbidden" to some crawlers
const isPublic = (p: string) => PUBLIC_PATHS.some(x => p.startsWith(x));

const AUTO_BLOCK_MINUTES = 60;

/** A person following a link or typing an address (a browser "navigation": downloads, a file opened in a new tab, the start and return of a Google login),
 *  as against a script or the page's own data requests (fetch). The first is sent to the login page; the second is told 401. */
const isNavigation = (req: NextRequest) => !req.nextUrl.pathname.startsWith('/api/') || req.headers.get('sec-fetch-mode') === 'navigate';

/** To the login page, remembering where the person was (the page and its query, without Next's own `_rsc` marker), and saying why when a session ended. */
function toLogin(req: NextRequest, reason?: 'idle' | 'expired'): NextResponse {
  const url = new URL('/login', req.url);
  const here = new URL(req.url);
  here.searchParams.delete('_rsc');
  url.searchParams.set('from', here.pathname + here.search);
  if (reason) url.searchParams.set('reason', reason);
  return NextResponse.redirect(url);
}

function denied(req: NextRequest, status: 403 | 429, error: string, retryAfterSec?: number): NextResponse {
  const headers = retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : undefined;
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error }, { status, headers });
  return new NextResponse(status === 429 ? 'アクセスが多すぎます。しばらくしてからもう一度お試しください。' : error === 'bots_not_allowed' ? 'ロボットによるアクセスは許可されていません。' : 'アクセスが許可されていません。', { status, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
}

let lastUnknownNoteAt = 0;
/** A request whose address cannot be told (broken proxy setup, forged header) is refused; the note is made at most once a minute. */
async function unknownAddress(req: NextRequest): Promise<NextResponse> {
  if (Date.now() - lastUnknownNoteAt > 60_000) {
    lastUnknownNoteAt = Date.now();
    await recordSecurityEvent({ type: 'ip_unknown', severity: 'warn', detail: { path: req.nextUrl.pathname, xff: req.headers.get('x-forwarded-for')?.slice(0, 200) ?? null } });
  }
  return denied(req, 403, 'ip_unknown');
}

/** Address-level rules, for every request: blocked addresses, allowed networks, and requests that come from another website. */
async function addressRules(req: NextRequest, ip: string): Promise<NextResponse | null> {
  const cron = req.nextUrl.pathname.startsWith('/api/cron/'); // called by the scheduler with a secret, not by people
  if (ip === 'unknown' && !cron) return unknownAddress(req); // every limit, block and session check is per address, so a request without one gets nothing
  if (await isIpBlocked(ip)) return denied(req, 403, 'access_denied');
  const policy = await loadSecurityPolicy();
  if (!cron && policy.allowedRules.length > 0 && !matchesAny(ip, policy.allowedRules)) return denied(req, 403, 'access_denied');

  const ownHosts = [req.headers.get('host'), req.headers.get('x-forwarded-host'), (() => { try { return new URL(process.env.NEXT_PUBLIC_APP_URL || '').host; } catch { return null; } })()];
  if (originProblem(req.method, req.headers.get('origin'), ownHosts)) {
    await recordSecurityEvent({ type: 'bad_origin', severity: 'warn', ip, detail: { origin: req.headers.get('origin'), path: req.nextUrl.pathname } });
    return denied(req, 403, 'bad_origin');
  }
  return null;
}

const botNoted = new Map<string, number>();
/** Robots (AI crawlers, scripts, headless browsers) are refused; the note is made at most once a minute per address and kind. */
async function botRules(req: NextRequest, ip: string): Promise<NextResponse | null> {
  if (req.nextUrl.pathname.startsWith('/api/cron/')) return null; // the scheduler is a script, and has its own secret
  if (botBlockForcedOff()) return null;
  const kind = botKind(req.headers.get('user-agent'), botAllowList());
  if (!kind) return null;
  if (!(await loadSecurityPolicy()).blockBots) return null;
  const key = `${ip}|${kind}`;
  if (Date.now() - (botNoted.get(key) ?? 0) > 60_000) {
    if (botNoted.size > 500) botNoted.clear();
    botNoted.set(key, Date.now());
    await recordSecurityEvent({ type: 'bot_blocked', severity: 'info', ip, detail: { kind, ua: req.headers.get('user-agent')?.slice(0, 200) ?? null, path: req.nextUrl.pathname } });
  }
  // The address of a robot is blocked too (an hour the first time, for good when it comes back).
  await blockIp({ ip, reason: `自動ブロック: ロボットの接続（${BOT_KIND_LABEL[kind]}）`, minutes: AUTO_BLOCK_MINUTES, source: 'auto' });
  return denied(req, 403, 'bots_not_allowed');
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

/** Where a session held for a changed address may still go: the proof itself, and the page that asks for it. */
const CONFIRM_PATHS = ['/api/auth/confirm-address', '/confirm-address'];
const isConfirmPath = (p: string) => CONFIRM_PATHS.some(c => p === c || p.startsWith(c + '/'));

const askedAt = new Map<string, number>();
/** The note that a session was asked to confirm a new address: once per session and address in 10 minutes (the page polls). */
async function noteAddressChange(session: Session, moved: Moved, path: string) {
  const key = `${session.sessionId}|${moved.to}`;
  if (Date.now() - (askedAt.get(key) ?? 0) < 10 * 60_000) return;
  if (askedAt.size > 1000) askedAt.clear();
  askedAt.set(key, Date.now());
  await recordSecurityEvent({ type: 'session_ip_changed', severity: 'info', ip: moved.to, userId: session.userId, detail: { expected: moved.from, got: moved.to, path } });
}

/** A session used from an address it was not proved from: nothing is answered (no data, no refreshed cookie) until the person confirms the address. */
async function heldForAddress(req: NextRequest, session: Session, moved: Moved): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (isConfirmPath(pathname)) return NextResponse.next();
  await noteAddressChange(session, moved, pathname);
  const headers = { 'Cache-Control': 'no-store' };
  let res: NextResponse;
  if (!isNavigation(req)) res = NextResponse.json({ error: 'address_changed' }, { status: 403, headers });
  else {
    const url = new URL('/confirm-address', req.url);
    const here = new URL(req.url);
    here.searchParams.delete('_rsc');
    url.searchParams.set('from', here.pathname + here.search);
    res = NextResponse.redirect(url, { headers });
  }
  await addPendingAddress(res, req, session.sessionId, moved.to); // this browser was refused from here: the proof that follows approves it
  return res;
}

/** Lockdown: every connection (pages, API, files, the scheduler's calls) is turned away until the admin lifts it on the server. */
const shutOut = (req: NextRequest, ip: string) => {
  void noteShutOut(ip);
  const headers = { 'Retry-After': '300', 'Cache-Control': 'no-store' };
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'lockdown' }, { status: 503, headers });
  return new NextResponse('ただいま安全のため、すべての接続を停止しています。しばらくしてからもう一度お試しください。', { status: 503, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
};

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (await isLockedDown()) return shutOut(req, clientIpFrom(name => req.headers.get(name)));
  if (isStatic(pathname)) return NextResponse.next();

  const ip = clientIpFrom(name => req.headers.get(name));
  const refused = await addressRules(req, ip);
  if (refused) return refused;
  const robot = await botRules(req, ip);
  if (robot) return robot;

  if (isPublic(pathname)) return NextResponse.next();

  const { session } = await getSessionFromRequest(req);
  if (!session) {
    const verdict = judgeUnauthenticated(ip, pathname);
    if (!verdict.ok) return sweepResponse(req, ip, verdict);
    // an API caller is told 401 (a redirect would be followed to the login page's HTML and read as an answer); a page goes to the login screen
    const res = !isNavigation(req) ? NextResponse.json({ error: 'unauthorized' }, { status: 401 }) : toLogin(req, req.cookies.has('sid') ? 'expired' : undefined);
    res.cookies.delete('sid'); // clear stale/expired cookie
    return res;
  }

  const verdict = judgeAuthenticated(session.userId, pathname);
  if (!verdict.ok) return sweepResponse(req, ip, verdict, session.userId);

  // A session that is over on the server (idle, logged out elsewhere, password changed, account locked ...) while its cookie is still well-formed: only the
  // DB knows. A page of it must not open (it could no longer load anything), and an API call must be answered 401 (a thrown error in a route would be a 500
  // that no screen understands). So both are checked here, for every request, before anything runs.
  const live = await verifyRequestSession(req);
  if (!live || 'ended' in live) {
    const res = !isNavigation(req)
      ? NextResponse.json({ error: 'unauthorized', reason: live && 'ended' in live ? live.ended : 'ended' }, { status: 401 })
      : toLogin(req, live && 'ended' in live && live.ended === 'idle' ? 'idle' : 'expired');
    res.cookies.delete('sid');
    return res;
  }
  // From an address the session was not proved from (the DB knows the confirmed ones): held until the person confirms it, see lib/address-confirm.ts
  if (live.moved) return heldForAddress(req, live.session, live.moved);

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
