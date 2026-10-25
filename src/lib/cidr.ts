// IP address rules: a single address, or an IPv4 range written as 192.168.0.0/24. Pure functions.

/** `::ffff:1.2.3.4` (how IPv4 clients can look on a dual-stack server) → `1.2.3.4`. */
export function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  return v.startsWith('::ffff:') && v.includes('.') ? v.slice(7) : v;
}

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export function ipv4ToInt(ip: string): number | null {
  const m = V4.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(n => n <= 255) ? ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3] : null;
}

export const looksLikeIp = (s: string) => ipv4ToInt(s) !== null || /^[0-9a-f:]+$/i.test(s) && s.includes(':') && s.length <= 45;

/** A rule is valid when it is an address, or an IPv4 address with a /0–32 prefix. */
export function isValidRule(rule: string): boolean {
  const [addr, bits, extra] = rule.trim().split('/');
  if (extra !== undefined) return false;
  if (bits === undefined) return looksLikeIp(normalizeIp(addr));
  const n = Number(bits);
  return ipv4ToInt(addr) !== null && /^\d{1,2}$/.test(bits) && n >= 0 && n <= 32;
}

export function ipMatches(ip: string, rule: string): boolean {
  const target = normalizeIp(ip);
  const [addr, bits] = rule.trim().split('/');
  if (bits === undefined) return normalizeIp(addr) === target;
  const a = ipv4ToInt(target), b = ipv4ToInt(addr);
  if (a === null || b === null) return false;
  const n = Number(bits);
  if (n === 0) return true;
  const mask = (0xffffffff << (32 - n)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

export const matchesAny = (ip: string, rules: string[]) => rules.some(r => ipMatches(ip, r));

/** One rule per line (or comma separated); blank lines and `# comments` are ignored. */
export function parseRules(text: string): string[] {
  return text.split(/[\n,]/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
}

/** This machine itself (a request that never went through the outside world). Never counted as an attacker, never auto-blocked. */
export const isLoopback = (ip: string) => { const v = normalizeIp(ip); return v === '::1' || v === 'localhost' || v.startsWith('127.'); };
