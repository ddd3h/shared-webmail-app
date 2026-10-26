// A sealed, tamper-proof note that expires on its own: carries a login across the two steps (password, then the code)
// without creating a session in between. The client can't read or change it, and it is useless after a few minutes.
import * as Iron from 'iron-webcrypto';
import { sessionPassword } from '@/lib/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cryptoImpl: any = globalThis.crypto;
export const SHORT_TTL_MS = 5 * 60 * 1000;

export type Typ = 'mfa-login' | 'mfa-setup-login' | 'mfa-enroll';

export async function sealShort<T extends object>(typ: Typ, data: T, ttlMs = SHORT_TTL_MS): Promise<string> {
  return Iron.seal(cryptoImpl, { typ, ...data }, sessionPassword(), { ...Iron.defaults, ttl: ttlMs }) as Promise<string>;
}

/** The note, if it is genuine, not expired and of the expected kind; otherwise null. */
export async function unsealShort<T extends object>(typ: Typ, token: unknown): Promise<(T & { typ: Typ }) | null> {
  if (typeof token !== 'string' || token.length > 4000) return null;
  try {
    const data = (await Iron.unseal(cryptoImpl, token, { '1': sessionPassword() }, { ...Iron.defaults, ttl: SHORT_TTL_MS })) as T & { typ: Typ };
    return data.typ === typ ? data : null;
  } catch {
    return null;
  }
}
