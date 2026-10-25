// Who is really calling? Behind a reverse proxy the address arrives in X-Forwarded-For, but the left-most entry is
// whatever the client wrote there, so it can be forged to dodge every per-IP limit. Each proxy of ours *appends* the
// address it saw, so the trustworthy entry is the N-th from the right, N = number of proxies we run (TRUSTED_PROXY_COUNT,
// default 1 = one nginx in front). 0 = no proxy: the header is ignored.
import { looksLikeIp, normalizeIp } from '@/lib/cidr';

export function trustedProxyCount(): number {
  const n = Number(process.env.TRUSTED_PROXY_COUNT ?? 1);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

export function clientIpFrom(get: (name: string) => string | null | undefined, trusted = trustedProxyCount()): string {
  if (trusted === 0) return 'unknown'; // no proxy of ours: nothing in the headers can be believed
  const chain = (get('x-forwarded-for') ?? '').split(',').map(s => normalizeIp(s)).filter(Boolean);
  const candidate = chain.length > 0 ? chain[Math.max(0, chain.length - trusted)] : normalizeIp(get('x-real-ip') ?? '');
  return candidate && looksLikeIp(candidate) ? candidate : 'unknown';
}
