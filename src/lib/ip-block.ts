// The list of addresses that may not reach the app: put there by an admin, or automatically when an address sweeps.
import { prisma } from '@/lib/db';
import { matchesAny, isValidRule, isLoopback } from '@/lib/cidr';
import { recordSecurityEvent } from '@/lib/security-events';
import { isTrustedIp } from '@/lib/security-settings';

const ttlMs = () => Number(process.env.SECURITY_CACHE_TTL_MS ?? 10_000);
type Rules = { manual: string[]; auto: string[] };
const g = globalThis as unknown as { __ipBlocks?: { at: number; rules: Rules } };

async function activeRules(): Promise<Rules> {
  if (g.__ipBlocks && Date.now() - g.__ipBlocks.at < ttlMs()) return g.__ipBlocks.rules;
  const rows = await prisma.ip_blocks.findMany({ where: { OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] }, select: { ip: true, source: true } });
  const rules = { manual: rows.filter(r => r.source !== 'auto').map(r => r.ip), auto: rows.filter(r => r.source === 'auto').map(r => r.ip) };
  g.__ipBlocks = { at: Date.now(), rules };
  return rules;
}
const forget = () => { g.__ipBlocks = undefined; };

/** Fails open: if the list can't be read, the request goes on (the other defences still apply).
 *  A block put in by hand always counts; an automatic one does not count for a trusted address (the admin's list of our own lines). */
export async function isIpBlocked(ip: string): Promise<boolean> {
  if (ip === 'unknown') return false;
  try {
    const { manual, auto } = await activeRules();
    if (matchesAny(ip, manual)) return true;
    return matchesAny(ip, auto) && !(await isTrustedIp(ip));
  } catch { return false; }
}

const skipNoted = new Map<string, number>();
/** A trusted address did something that would have blocked it: noted (once in 10 minutes per address), not blocked. */
async function noteTrustedNotBlocked(ip: string, reason: string) {
  if (Date.now() - (skipNoted.get(ip) ?? 0) < 10 * 60_000) return;
  if (skipNoted.size > 500) skipNoted.clear();
  skipNoted.set(ip, Date.now());
  await recordSecurityEvent({ type: 'trusted_ip_not_blocked', severity: 'info', ip, detail: { reason } });
}

/** An automatic block of an address that was blocked automatically before (sweeping, or a robot) is permanent. */
export const REPEAT_BLOCK_LABEL = '再発のため永久ブロック';

export async function blockIp(o: { ip: string; reason: string; minutes?: number | null; source: 'manual' | 'auto'; byUserId?: string | null }): Promise<boolean> {
  if (!isValidRule(o.ip) || o.ip === 'unknown') return false;
  if (o.source === 'auto' && isLoopback(o.ip)) return false; // never lock out this machine itself
  if (o.source === 'auto' && await isTrustedIp(o.ip)) { await noteTrustedNotBlocked(o.ip, o.reason); return false; } // nor our own lines
  let minutes = o.minutes;
  let reason = o.reason;
  if (o.source === 'auto') {
    // Still blocked: the same offence seen again while the block runs (requests in flight) is not a new offence.
    const current = await prisma.ip_blocks.findUnique({ where: { ip: o.ip } });
    if (current && (current.expires_at === null || current.expires_at > new Date())) return true;
    const h = await prisma.ip_block_history.upsert({
      where: { ip: o.ip }, create: { ip: o.ip, count: 1 }, update: { count: { increment: 1 }, last_at: new Date() },
    });
    if (h.count >= 2) { minutes = null; reason = `${REPEAT_BLOCK_LABEL}（${h.count}回目）: ${o.reason.replace(/^自動ブロック: /, '')}`; }
  }
  const expires_at = minutes ? new Date(Date.now() + minutes * 60_000) : null;
  await prisma.ip_blocks.upsert({
    where: { ip: o.ip }, create: { ip: o.ip, reason, source: o.source, expires_at, created_by_id: o.byUserId ?? null },
    update: { reason, expires_at, source: o.source },
  });
  forget();
  if (o.source === 'auto') await recordSecurityEvent({ type: 'ip_blocked', severity: 'alert', ip: o.ip, detail: { reason, minutes, permanent: minutes === null } });
  return true;
}

export async function unblockIp(id: string): Promise<void> {
  await prisma.ip_blocks.delete({ where: { id } }).catch(() => {});
  forget();
}
