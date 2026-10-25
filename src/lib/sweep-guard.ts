// Spotting somebody who is sweeping the app (probing many paths, or reading record after record) from the request stream.
// State is in memory: this guards a single running instance, and a restart only forgets the last few minutes.
import { isLoopback } from '@/lib/cidr';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { budgetFor, isRecordPath } from '@/lib/api-budget';

const MINUTE = 60_000;
export const SWEEP = {
  distinctPathsUnauth: 15,    // different paths asked for without a session, within 5 minutes → scanning
  unauthApiPerMinute: 30,     // API calls without a session per minute per address
  distinctRecordsPerMinute: 80,// different record URLs read by one signed-in person within a minute → reading record after record
};

const g = globalThis as unknown as { __sweepPaths?: Map<string, { paths: Set<string>; resetAt: number }>; __sweepRecords?: Map<string, { paths: Set<string>; resetAt: number }> };
const unauthPaths = (g.__sweepPaths ??= new Map());
const recordPaths = (g.__sweepRecords ??= new Map());

function addDistinct(store: Map<string, { paths: Set<string>; resetAt: number }>, key: string, value: string, windowMs: number, now: number): number {
  if (store.size > 20_000) for (const [k, v] of store) if (now > v.resetAt) store.delete(k);
  let e = store.get(key);
  if (!e || now > e.resetAt) { e = { paths: new Set(), resetAt: now + windowMs }; store.set(key, e); }
  e.paths.add(value);
  return e.paths.size;
}

/** Forgets the paths an address asked for and its unauthenticated-call count. */
export function forgetSweep(ip: string) {
  unauthPaths.delete(ip);
  resetRateLimit(`unauth-api:${ip}`);
}

export type Verdict = { ok: true } | { ok: false; status: 429; reason: string; retryAfterSec: number; sweep: boolean };

/** A request that carries no valid session. `sweep: true` means the address should be blocked, not only slowed. */
export function judgeUnauthenticated(ip: string, pathname: string, now = Date.now()): Verdict {
  if (ip === 'unknown' || isLoopback(ip)) return { ok: true };
  if (addDistinct(unauthPaths, ip, pathname, 5 * MINUTE, now) > SWEEP.distinctPathsUnauth) return { ok: false, status: 429, reason: 'unauthenticated_path_scan', retryAfterSec: 300, sweep: true };
  if (pathname.startsWith('/api/')) {
    const r = checkRateLimit(`unauth-api:${ip}`, SWEEP.unauthApiPerMinute, MINUTE);
    if (!r.allowed) return { ok: false, status: 429, reason: 'unauthenticated_api_flood', retryAfterSec: r.retryAfterSec, sweep: r.isFirstBlock };
  }
  return { ok: true };
}

// People who are not held to the per-endpoint budgets (for example an accounting robot that downloads in bulk), by user id.
const exempt = (userId: string) => (process.env.API_BUDGET_EXEMPT_USER_IDS ?? '').split(',').map(x => x.trim()).filter(Boolean).includes(userId);

/** A request of a signed-in person: the per-endpoint budget, and reading record after record. */
export function judgeAuthenticated(userId: string, pathname: string, now = Date.now()): Verdict {
  if (exempt(userId)) return { ok: true };
  const b = budgetFor(pathname);
  if (pathname.startsWith('/api/')) {
    const r = checkRateLimit(`api:${userId}:${b.group}`, b.perMinute, MINUTE);
    if (!r.allowed) return { ok: false, status: 429, reason: `budget_${b.group}`, retryAfterSec: r.retryAfterSec, sweep: r.isFirstBlock && b.group !== 'api' };
    if (isRecordPath(pathname) && addDistinct(recordPaths, userId, pathname, MINUTE, now) > SWEEP.distinctRecordsPerMinute) {
      return { ok: false, status: 429, reason: 'record_sweep', retryAfterSec: 60, sweep: true };
    }
  }
  return { ok: true };
}
