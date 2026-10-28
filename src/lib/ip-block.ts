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

export async function blockIp(o: { ip: string; reason: string; minutes?: number | null; source: 'manual' | 'auto'; byUserId?: string | null }): Promise<boolean> {
  if (!isValidRule(o.ip) || o.ip === 'unknown') return false;
  if (o.source === 'auto' && isLoopback(o.ip)) return false; // never lock out this machine itself
  const expires_at = o.minutes ? new Date(Date.now() + o.minutes * 60_000) : null;
  await prisma.ip_blocks.upsert({
    where: { ip: o.ip }, create: { ip: o.ip, reason: o.reason, source: o.source, expires_at, created_by_id: o.byUserId ?? null },
    update: { reason: o.reason, expires_at, source: o.source },
  });
  forget();
  if (o.source === 'auto') await recordSecurityEvent({ type: 'ip_blocked', severity: 'alert', ip: o.ip, detail: { reason: o.reason, minutes: o.minutes } });
  return true;
}

export async function unblockIp(id: string): Promise<void> {
  await prisma.ip_blocks.delete({ where: { id } }).catch(() => {});
  forget();
}
