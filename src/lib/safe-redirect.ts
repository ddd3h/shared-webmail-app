// Where to go after logging in: only a page of this app. Anything that could lead to another site is dropped (an "open redirect":
// a link such as /login?from=https://evil.example would send a person who just typed their password to a look-alike page).
const FALLBACK = '/';

/** `raw` (the `from` of the login address) when it is a path inside this app; otherwise `/`. */
export function safeFrom(raw: string | null | undefined, fallback = FALLBACK): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return fallback;
  // only "/something": not "//host" (protocol-relative), not "/\host" (browsers read the backslash as a slash), no scheme, no control characters or whitespace tricks
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  // never back to the login screen itself (a loop), nor to the API
  if (/^\/(login|api)(\/|\?|$)/.test(raw)) return fallback;
  try {
    const u = new URL(raw, 'https://app.invalid');
    if (u.origin !== 'https://app.invalid') return fallback;
    return u.pathname + u.search + u.hash;
  } catch { return fallback; }
}
