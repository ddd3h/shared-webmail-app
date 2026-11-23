import { resolveTxt } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { cacheLife, cacheTag } from 'next/cache';
import { combine, readThrough, senderKey, type Fetched } from '@/lib/image-store';

const MAX_ICON_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5000;

// 個人利用が主のメールドメイン → 企業アイコン(favicon)は探さず Gravatar のみ試す
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.co.jp', 'yahoo.com', 'ymail.ne.jp',
  'outlook.com', 'outlook.jp', 'hotmail.com', 'hotmail.co.jp', 'live.jp', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'gmx.net', 'mail.com',
  'docomo.ne.jp', 'ezweb.ne.jp', 'au.com', 'softbank.ne.jp', 'i.softbank.jp', 'ymobile.ne.jp',
  'nifty.com', 'so-net.ne.jp', 'biglobe.ne.jp', 'ocn.ne.jp', 'plala.or.jp',
]);

export type SenderIcon = { data: Buffer; contentType: string; etag: string; source: 'bimi' | 'favicon' | 'gravatar' };

export function extractDomain(email: string): string | null {
  const m = email.toLowerCase().trim().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
}

export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain);
}

// `none`: the site answered that there is no such picture (4xx, not an image, too large). `failed`: it could not be asked
// (no answer in time, 5xx, 429): the picture kept from before is shown on.
async function fetchImage(url: string, allowedTypes?: RegExp): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'WebMailApp/1.0' },
      redirect: 'follow',
    });
    if (res.status >= 500 || res.status === 429) return { kind: 'failed' };
    if (!res.ok) return { kind: 'none' };
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return { kind: 'none' };
    if (allowedTypes && !allowedTypes.test(contentType)) return { kind: 'none' };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_ICON_BYTES) return { kind: 'none' };
    return { kind: 'found', data: buf, contentType };
  } catch {
    return { kind: 'failed' };
  }
}

// BIMI: DNS TXT default._bimi.<domain> → "v=BIMI1; l=<SVGロゴURL>"
async function lookupBimi(domain: string): Promise<Fetched> {
  let records: string[][];
  try {
    records = await resolveTxt(`default._bimi.${domain}`);
  } catch (e) {
    // no record at all is an answer; a DNS server that did not answer is not
    const code = (e as NodeJS.ErrnoException)?.code;
    return code === 'ENOTFOUND' || code === 'ENODATA' ? { kind: 'none' } : { kind: 'failed' };
  }
  for (const chunks of records) {
    const record = chunks.join('');
    if (!/^v=BIMI1\b/i.test(record.trim())) continue;
    const m = record.match(/\bl=([^;]+)/i);
    const url = m?.[1]?.trim();
    if (!url || !url.startsWith('https://')) continue;
    return fetchImage(url, /^image\/svg\+xml$/);
  }
  return { kind: 'none' };
}

async function lookupFavicon(domain: string): Promise<Fetched> {
  return fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
}

async function lookupGravatar(email: string): Promise<Fetched> {
  const hash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  return fetchImage(`https://gravatar.com/avatar/${hash}?d=404&s=128`);
}

// Seconds: a found icon is reused for a day, "no icon" is looked up again after six hours; an expired entry is
// replaced in the background while the old one is still served.
const FOUND = { stale: 3600, revalidate: 24 * 3600, expire: 7 * 24 * 3600 };
const MISSING = { stale: 300, revalidate: 6 * 3600, expire: 24 * 3600 };

// Look the icon up (memory → database → the internet). Personal domains are asked per address (Gravatar), the others per domain.
// The database keeps it under a hash of the address / domain (lib/image-store.ts), so a restart does not look everything up again.
async function resolveIcon(kind: 'email' | 'domain', value: string) {
  'use cache';
  cacheTag('sender-icons');

  const { image, ttl } = await readThrough({
    key: senderKey(kind, value),
    fresh: { found: FOUND.revalidate, none: MISSING.revalidate },
    fetch: async (): Promise<Fetched> => {
      if (kind === 'email') {
        const g = await lookupGravatar(value);
        return g.kind === 'found' ? { ...g, source: 'gravatar' } : g;
      }
      const bimi = await lookupBimi(value);
      if (bimi.kind === 'found') return { ...bimi, source: 'bimi' };
      const fav = await lookupFavicon(value);
      return combine([bimi, fav.kind === 'found' ? { ...fav, source: 'favicon' } : fav]);
    },
  });

  const base = image ? FOUND : MISSING;
  const revalidate = Math.max(60, Math.min(base.revalidate, ttl));
  cacheLife({ stale: Math.min(base.stale, revalidate), revalidate, expire: base.expire });
  return image;
}

const SOURCES: SenderIcon['source'][] = ['bimi', 'favicon', 'gravatar'];

// 解決順: BIMI → 企業favicon（個人ドメインは Gravatar のみ）。見つからなければ null。
export async function lookupSenderIcon(email: string): Promise<SenderIcon | null> {
  const domain = extractDomain(email);
  if (!domain) return null;
  const kept = isPersonalDomain(domain) ? await resolveIcon('email', email.toLowerCase().trim()) : await resolveIcon('domain', domain);
  if (!kept) return null;
  const source = SOURCES.find(s => s === kept.source) ?? 'favicon';
  return { data: Buffer.from(kept.base64, 'base64'), contentType: kept.contentType, etag: kept.etag, source };
}
