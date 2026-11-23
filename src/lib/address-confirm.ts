// A session used from an address it was not proved from is held (see checkLive in lib/auth.ts) until the person proves who they are again
// there, the way they log in: with the passkey when they have one, otherwise the password (and the code, when a second factor is set).
// Then the address joins the session's confirmed addresses and the session goes on from it, without logging in again.
//
// Which addresses a proof approves: the address of the proof request itself, and the addresses this browser was refused from. Some lines
// send every connection out through one of several addresses, so the proof may well arrive from an address that is already known while the
// one that was refused is another. The refused addresses travel in a sealed, HttpOnly cookie that only the server writes, bound to the
// session: never in the address bar or a request body, where a link from a thief could name the thief's own address for the owner to approve.
import type { NextRequest, NextResponse } from 'next/server';
import * as Iron from 'iron-webcrypto';
import { sessionPassword } from '@/lib/auth';
import { looksLikeIp } from '@/lib/cidr';
import { sameNetwork } from '@/lib/client-ip';
import { passwordLoginAllowed } from '@/lib/passkey-policy';
import { hasTotp } from '@/lib/mfa';

const isProd = process.env.NODE_ENV === 'production';
// `__Host-`: the browser only takes it from this very host over HTTPS (a neighbouring subdomain cannot plant one)
export const PENDING_COOKIE = isProd ? '__Host-addr_pending' : 'addr_pending';
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 8;
/** A session keeps at most this many confirmed addresses (the oldest are dropped). */
export const MAX_CONFIRMED = 20;

type Pending = { kind: 'address_pending'; sid: string; ips: string[]; exp: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cryptoImpl: any = globalThis.crypto;

/** The refused addresses this browser carries for `sessionId` (none when the cookie is missing, forged, expired or of another session). */
export async function pendingAddresses(token: string | undefined, sessionId: string): Promise<string[]> {
  if (!token) return [];
  try {
    const p = (await Iron.unseal(cryptoImpl, token, { '1': sessionPassword() }, { ...Iron.defaults, ttl: 0 })) as Pending;
    if (p?.kind !== 'address_pending' || p.sid !== sessionId || !(p.exp > Date.now()) || !Array.isArray(p.ips)) return [];
    return p.ips.filter(ip => typeof ip === 'string' && looksLikeIp(ip));
  } catch { return []; }
}

/** Notes on `res` that this browser was refused from `ip` (for the proof that follows). */
export async function addPendingAddress(res: NextResponse, req: NextRequest, sessionId: string, ip: string): Promise<void> {
  if (!looksLikeIp(ip)) return;
  const before = await pendingAddresses(req.cookies.get(PENDING_COOKIE)?.value, sessionId);
  if (before.some(p => sameNetwork(p, ip))) return; // nothing new: leave the cookie as it is
  const pending: Pending = { kind: 'address_pending', sid: sessionId, ips: [...before, ip].slice(-MAX_PENDING), exp: Date.now() + PENDING_TTL_MS };
  const token = await Iron.seal(cryptoImpl, pending, sessionPassword(), { ...Iron.defaults, ttl: 0 });
  res.cookies.set(PENDING_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: isProd, maxAge: PENDING_TTL_MS / 1000 });
}

export function clearPendingAddresses(res: NextResponse): void {
  res.cookies.set(PENDING_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', secure: isProd, maxAge: 0 });
}

/** The addresses among `candidates` that the session does not know yet (each line once). */
export function newAddresses(candidates: string[], known: string[]): string[] {
  const out: string[] = [];
  for (const ip of candidates) {
    if (!looksLikeIp(ip) || [...known, ...out].some(k => sameNetwork(ip, k))) continue;
    out.push(ip);
  }
  return out;
}

/** The confirmed addresses after `added` join them (newest last, at most MAX_CONFIRMED). */
export function withConfirmed(confirmed: string[], added: string[]): string[] {
  return [...confirmed.filter(c => !added.some(a => sameNetwork(a, c))), ...added].slice(-MAX_CONFIRMED);
}

export type ProofMethod = 'passkey' | 'password' | 'none';
/** How this person proves who they are: as at the login (a person with a passkey uses it; the password alone is not enough then). */
export function proofMethod(user: { password_hash: string | null }, passkeyCount: number): ProofMethod {
  if (!passwordLoginAllowed(passkeyCount)) return 'passkey';
  return user.password_hash ? 'password' : 'none';
}
export const needsCode = (user: { totp_secret_enc: string | null; totp_enabled_at: Date | null }) => hasTotp(user);
