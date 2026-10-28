import { resolveTxt } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { cacheLife, cacheTag } from 'next/cache';

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

export type SenderIcon = { data: Buffer; contentType: string; source: 'bimi' | 'favicon' | 'gravatar' };

export function extractDomain(email: string): string | null {
  const m = email.toLowerCase().trim().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
}

export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain);
}

async function fetchImage(url: string, allowedTypes?: RegExp): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'WebMailApp/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    if (allowedTypes && !allowedTypes.test(contentType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_ICON_BYTES) return null;
    return { data: buf, contentType };
  } catch {
    return null;
  }
}

// BIMI: DNS TXT default._bimi.<domain> → "v=BIMI1; l=<SVGロゴURL>"
async function lookupBimi(domain: string): Promise<{ data: Buffer; contentType: string } | null> {
  let records: string[][];
  try {
    records = await resolveTxt(`default._bimi.${domain}`);
  } catch {
    return null;
  }
  for (const chunks of records) {
    const record = chunks.join('');
    if (!/^v=BIMI1\b/i.test(record.trim())) continue;
    const m = record.match(/\bl=([^;]+)/i);
    const url = m?.[1]?.trim();
    if (!url || !url.startsWith('https://')) continue;
    const img = await fetchImage(url, /^image\/svg\+xml$/);
    if (img) return img;
  }
  return null;
}

async function lookupFavicon(domain: string): Promise<{ data: Buffer; contentType: string } | null> {
  return fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
}

async function lookupGravatar(email: string): Promise<{ data: Buffer; contentType: string } | null> {
  const hash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  return fetchImage(`https://gravatar.com/avatar/${hash}?d=404&s=128`);
}

// Seconds: a found icon is reused for a day, "no icon" is looked up again after six hours; an expired entry is
// replaced in the background while the old one is still served.
const FOUND = { stale: 3600, revalidate: 24 * 3600, expire: 7 * 24 * 3600 };
const MISSING = { stale: 300, revalidate: 6 * 3600, expire: 24 * 3600 };

// What the cache keeps: plain data only (a Buffer is a class instance, which cannot be stored), the image as base64.
type StoredIcon = { base64: string; contentType: string; source: SenderIcon['source'] };

// Look the icon up on the internet; the cache keeps the answer for the lifetime above.
// Personal domains are asked per address (Gravatar), the others per domain.
async function resolveIcon(kind: 'email' | 'domain', value: string): Promise<StoredIcon | null> {
  'use cache';
  cacheTag('sender-icons');

  let icon: SenderIcon | null = null;
  if (kind === 'email') {
    const g = await lookupGravatar(value);
    if (g) icon = { ...g, source: 'gravatar' };
  } else {
    const bimi = await lookupBimi(value);
    if (bimi) {
      icon = { ...bimi, source: 'bimi' };
    } else {
      const fav = await lookupFavicon(value);
      if (fav) icon = { ...fav, source: 'favicon' };
    }
  }

  cacheLife(icon ? FOUND : MISSING);
  return icon && { base64: icon.data.toString('base64'), contentType: icon.contentType, source: icon.source };
}

// 解決順: BIMI → 企業favicon（個人ドメインは Gravatar のみ）。見つからなければ null。
export async function lookupSenderIcon(email: string): Promise<SenderIcon | null> {
  const domain = extractDomain(email);
  if (!domain) return null;
  const stored = isPersonalDomain(domain) ? await resolveIcon('email', email.toLowerCase().trim()) : await resolveIcon('domain', domain);
  return stored && { data: Buffer.from(stored.base64, 'base64'), contentType: stored.contentType, source: stored.source };
}
