// The list of addresses that may not reach the app: put there by an admin, or automatically when an address sweeps.
import { prisma } from '@/lib/db';
import { matchesAny, isValidRule, isLoopback } from '@/lib/cidr';
import { recordSecurityEvent } from '@/lib/security-events';

const ttlMs = () => Number(process.env.SECURITY_CACHE_TTL_MS ?? 10_000);
const g = globalThis as unknown as { __ipBlocks?: { at: number; rules: string[] } };

async function activeRules(): Promise<string[]> {
  if (g.__ipBlocks && Date.now() - g.__ipBlocks.at < ttlMs()) return g.__ipBlocks.rules;
  const rows = await prisma.ip_blocks.findMany({ where: { OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] }, select: { ip: true } });
  g.__ipBlocks = { at: Date.now(), rules: rows.map(r => r.ip) };
  return g.__ipBlocks.rules;
}
const forget = () => { g.__ipBlocks = undefined; };

/** Fails open: if the list can't be read, the request goes on (the other defences still apply). */
export async function isIpBlocked(ip: string): Promise<boolean> {
  if (ip === 'unknown') return false;
  try { return matchesAny(ip, await activeRules()); } catch { return false; }
}

/** An automatic block of an address that was blocked automatically before (sweeping, or a robot) is permanent. */
export const REPEAT_BLOCK_LABEL = '再発のため永久ブロック';

export async function blockIp(o: { ip: string; reason: string; minutes?: number | null; source: 'manual' | 'auto'; byUserId?: string | null }): Promise<boolean> {
  if (!isValidRule(o.ip) || o.ip === 'unknown') return false;
  if (o.source === 'auto' && isLoopback(o.ip)) return false; // never lock out this machine itself
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
