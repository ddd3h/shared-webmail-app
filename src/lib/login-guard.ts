// Everything that decides "may this login attempt even be tried?" — before any password is checked.
// Layers (cheapest first): blocked address → allowed networks → sweeping (one address trying many accounts)
// → per-address limit → per-account-per-address limit → per-account limit → persisted failure count.
import { prisma } from '@/lib/db';
import { isLoopback, matchesAny } from '@/lib/cidr';
import { isIpBlocked, blockIp } from '@/lib/ip-block';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { recordSecurityEvent } from '@/lib/security-events';

export const WINDOW_MS = 15 * 60 * 1000;
export const LIMITS = {
  perIp: 20,            // attempts per window from one address
  perEmailPerIp: 5,     // one account from one address (a typo-prone person is slowed, not locked out)
  perEmail: 15,         // one account from everywhere, for callers without a device cookie we recognise
  persistedPerEmail: 40,// failures in the DB log (survives restarts)
  distinctEmails: 8,    // different accounts tried from one address within SWEEP_WINDOW_MS = sweeping
};
export const SWEEP_WINDOW_MS = 10 * 60 * 1000;
const AUTO_BLOCK_MINUTES = 60;
const STRIKES_BEFORE_BLOCK = 3;

export const normalizeEmail = (email: unknown): string => (typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '');

export type Verdict =
  | { ok: true }
  | { ok: false; status: 403 | 429; error: 'access_denied' | 'too_many_requests'; reason: string; retryAfterSec: number; firstBlock?: boolean; scope?: 'ip' | 'email' };

const deny = (status: 403 | 429, reason: string, retryAfterSec = 0, extra: Partial<Verdict> = {}): Verdict =>
  ({ ok: false, status, error: status === 403 ? 'access_denied' : 'too_many_requests', reason, retryAfterSec, ...extra }) as Verdict;

// ---- sweeping: how many different accounts has this address tried lately? ----
const g = globalThis as unknown as { __sweepEmails?: Map<string, { emails: Set<string>; resetAt: number }> };
const sweeps = (g.__sweepEmails ??= new Map());

/** Remembers that `ip` tried `email`; returns how many different accounts it has tried within the window. */
export function noteAccountTried(ip: string, email: string, now = Date.now()): number {
  if (sweeps.size > 20_000) for (const [k, v] of sweeps) if (now > v.resetAt) sweeps.delete(k);
  let entry = sweeps.get(ip);
  if (!entry || now > entry.resetAt) { entry = { emails: new Set(), resetAt: now + SWEEP_WINDOW_MS }; sweeps.set(ip, entry); }
  entry.emails.add(email);
  return entry.emails.size;
}

/** Forgets what was counted against an address (used when an admin lifts its block, so it isn't blocked again at once). */
export function forgetLoginHistory(ip: string) {
  sweeps.delete(ip);
  for (const key of [`strike:${ip}`, `login:ip:${ip}`]) resetRateLimit(key);
}

/** Repeated limit hits from one address become a temporary block. Returns true when it just got blocked. */
export async function addStrike(ip: string, why: string): Promise<boolean> {
  if (ip === 'unknown') return false;
  // allowed up to (STRIKES - 1) strikes; the next one is the first "blocked" answer, and only that one blocks the address
  const s = checkRateLimit(`strike:${ip}`, STRIKES_BEFORE_BLOCK - 1, 60 * 60 * 1000);
  return s.isFirstBlock ? blockIp({ ip, reason: `自動ブロック: ${why}`, minutes: AUTO_BLOCK_MINUTES, source: 'auto' }) : false;
}

async function failuresInDb(email: string): Promise<number> {
  try { return await prisma.login_logs.count({ where: { email, success: false, created_at: { gt: new Date(Date.now() - WINDOW_MS) } } }); } catch { return 0; }
}

/** The address-only part of the gate (blocked address, allowed networks) for endpoints that have no account name to look at. */
export async function gateAddress(ip: string): Promise<Verdict> {
  if (await isIpBlocked(ip)) return deny(403, 'ip_blocked');
  const policy = await loadSecurityPolicy();
  if (policy.allowedRules.length > 0 && ip !== 'unknown' && !matchesAny(ip, policy.allowedRules)) return deny(403, 'network_not_allowed');
  return { ok: true };
}

export async function gateLogin(o: { ip: string; email: string; knownDevice: boolean }): Promise<Verdict> {
  const { ip, email, knownDevice } = o;
  const address = await gateAddress(ip);
  if (!address.ok) return address;

  if (ip !== 'unknown' && !isLoopback(ip) && noteAccountTried(ip, email) > LIMITS.distinctEmails) {
    await blockIp({ ip, reason: `自動ブロック: 短時間に多数のアカウントを試行（スイーピング）`, minutes: AUTO_BLOCK_MINUTES, source: 'auto' });
    await recordSecurityEvent({ type: 'login_sweep', severity: 'alert', ip, detail: { distinct_accounts: LIMITS.distinctEmails + 1, window_min: SWEEP_WINDOW_MS / 60000 } });
    return deny(403, 'sweep_blocked');
  }

  const ipR = checkRateLimit(`login:ip:${ip}`, LIMITS.perIp, WINDOW_MS);
  if (!ipR.allowed) {
    if (ipR.isFirstBlock) await addStrike(ip, 'ログイン試行が多すぎます');
    return deny(429, 'rate_limited_ip', ipR.retryAfterSec, { firstBlock: ipR.isFirstBlock, scope: 'ip' });
  }
  const pairR = checkRateLimit(`login:pair:${email}|${ip}`, LIMITS.perEmailPerIp, WINDOW_MS);
  if (!pairR.allowed) return deny(429, 'rate_limited_account_ip', pairR.retryAfterSec, { firstBlock: pairR.isFirstBlock, scope: 'email' });

  // An attacker can't lock a person out of their own known browser: the account-wide limits don't apply to it.
  if (!knownDevice) {
    const emailR = checkRateLimit(`login:email:${email}`, LIMITS.perEmail, WINDOW_MS);
    if (!emailR.allowed) return deny(429, 'rate_limited_account', emailR.retryAfterSec, { firstBlock: emailR.isFirstBlock, scope: 'email' });
    if ((await failuresInDb(email)) >= LIMITS.persistedPerEmail) return deny(429, 'rate_limited_account_persisted', WINDOW_MS / 1000, { scope: 'email' });
  }
  return { ok: true };
}
