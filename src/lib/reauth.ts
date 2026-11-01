// "Prove it again": the actions that can do the most harm (changing who can get in, moving money, reading everybody's personal data, changing the
// security rules) need a RECENT proof of who is asking: the password (and the code) typed in the last few minutes, not just a session that has
// been alive for days. A stolen cookie or an unlocked laptop then cannot do them. This is "verify explicitly, per request" of zero trust.
import { NextResponse } from 'next/server';
import { getSession, type Session } from '@/lib/auth';
import { getSetting } from '@/lib/settings';

export const DEFAULT_REAUTH_MINUTES = 15;
export const MAX_REAUTH_MINUTES = 240;

const g = globalThis as unknown as { __reauthMinutes?: { at: number; value: number } };
const ttlMs = () => Number(process.env.SECURITY_CACHE_TTL_MS ?? 15_000);

/** How recent the proof has to be, in minutes (0 = not asked). Set in the security settings. */
export async function reauthMinutes(): Promise<number> {
  if (g.__reauthMinutes && Date.now() - g.__reauthMinutes.at < ttlMs()) return g.__reauthMinutes.value;
  const raw = await getSetting('SECURITY_REAUTH_MINUTES').catch(() => null);
  const n = Number(raw);
  const value = raw != null && raw !== '' && Number.isInteger(n) && n >= 0 && n <= MAX_REAUTH_MINUTES ? n : DEFAULT_REAUTH_MINUTES;
  g.__reauthMinutes = { at: Date.now(), value };
  return value;
}
export const forgetReauthMinutes = () => { g.__reauthMinutes = undefined; };

/** When the person last proved who they are: the login (a password was typed) or a later "prove it again". A session made by the installed app's
 *  key proved the DEVICE, not the person at this moment: only a "prove it again" counts there. */
export function provedAt(s: Pick<Session, 'issuedAt' | 'reauthAt' | 'resumed'>): number {
  return Math.max(s.resumed ? 0 : s.issuedAt ?? 0, s.reauthAt ?? 0);
}

export const isRecent = (s: Pick<Session, 'issuedAt' | 'reauthAt' | 'resumed'>, minutes: number, now = Date.now()) => minutes <= 0 || now - provedAt(s) <= minutes * 60_000;

export const recentLoginRequired = () => NextResponse.json(
  { error: 'recent_login_required', message: 'この操作は、安全のため、パスワードを入れ直してから行います' }, { status: 403 },
);

/** For a high-risk route, after the role check: null when it may go on, otherwise the answer to send (403 `recent_login_required`; the screen asks for the
 *  password and sends the same request again). */
export async function recentAuthOrResponse(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session) return null; // (the route's own check answers 401)
  return isRecent(session, await reauthMinutes()) ? null : recentLoginRequired();
}
