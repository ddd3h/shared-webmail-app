import { resolveTxt } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'storage', 'sender-icons');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours for "no icon found"
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

function cacheKey(email: string, domain: string): string {
  // 個人ドメインはメール単位(Gravatar)、それ以外はドメイン単位でキャッシュ
  const raw = isPersonalDomain(domain) ? `email:${email.toLowerCase().trim()}` : `domain:${domain}`;
  return createHash('sha256').update(raw).digest('hex');
}

async function readCache(key: string): Promise<SenderIcon | null | undefined> {
  try {
    const file = path.join(CACHE_DIR, key);
    const s = await stat(`${file}.meta`);
    const meta = JSON.parse(await readFile(`${file}.meta`, 'utf8')) as { contentType: string; source: SenderIcon['source'] | 'none' };
    if (meta.source === 'none') {
      if (Date.now() - s.mtimeMs > NEGATIVE_TTL_MS) return undefined;
      return null;
    }
    if (Date.now() - s.mtimeMs > TTL_MS) return undefined;
    const data = await readFile(file);
    return { data, contentType: meta.contentType, source: meta.source };
  } catch {
    return undefined; // キャッシュなし
  }
}

async function writeCache(key: string, icon: SenderIcon | null): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, key);
  if (icon) {
    await Promise.all([
      writeFile(file, icon.data),
      writeFile(`${file}.meta`, JSON.stringify({ contentType: icon.contentType, source: icon.source })),
    ]);
  } else {
    await writeFile(`${file}.meta`, JSON.stringify({ source: 'none' }));
  }
}

// 解決順: BIMI → 企業favicon（個人ドメインは Gravatar のみ）。見つからなければ null。
export async function lookupSenderIcon(email: string): Promise<SenderIcon | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  const key = cacheKey(email, domain);
  const cached = await readCache(key);
  if (cached !== undefined) return cached;

  let icon: SenderIcon | null = null;
  if (isPersonalDomain(domain)) {
    const g = await lookupGravatar(email);
    if (g) icon = { ...g, source: 'gravatar' };
  } else {
    const bimi = await lookupBimi(domain);
    if (bimi) {
      icon = { ...bimi, source: 'bimi' };
    } else {
      const fav = await lookupFavicon(domain);
      if (fav) icon = { ...fav, source: 'favicon' };
    }
  }

  writeCache(key, icon).catch(() => {});
  return icon;
}
