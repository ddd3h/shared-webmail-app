// The installed app's own key (see lib/remember-login.ts for the server side).
// An ECDSA P-256 key pair is made with WebCrypto as NOT extractable: the private key is stored in IndexedDB as a CryptoKey
// object, and no script (this app's included) can read its bytes - it can only ask the browser to sign with it.
// localStorage only holds a harmless flag ("this app keeps me logged in") that tells the login page to try the key.

export const REMEMBER_FLAG = 'pwa-remember';
const DB_NAME = 'webmail-device';
const STORE = 'keys';
const RECORD = 'main';
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

type KeyRecord = { privateKey: CryptoKey; keyId: string };

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

/** Home-screen app (and not a tab in a browser)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export const deviceKeySupported = () => typeof window !== 'undefined' && !!window.crypto?.subtle && !!window.indexedDB;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Makes a new key pair (replacing an old one) and returns the public key to give to the server (SPKI, base64url). */
export async function createDeviceKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey); // the public half is always exportable
  const record: KeyRecord = { privateKey: pair.privateKey, keyId: hex(await crypto.subtle.digest('SHA-256', spki)) };
  await run('readwrite', s => s.put(record, RECORD));
  return b64url(new Uint8Array(spki));
}

export async function hasDeviceKey(): Promise<boolean> {
  try { return !!(await run<KeyRecord | undefined>('readonly', s => s.get(RECORD))); } catch { return false; }
}

export async function dropDeviceKey(): Promise<void> {
  try { await run('readwrite', s => s.delete(RECORD)); } catch { /* nothing stored, or storage blocked */ }
}

export const setRememberFlag = (on: boolean) => {
  try { if (on) localStorage.setItem(REMEMBER_FLAG, '1'); else localStorage.removeItem(REMEMBER_FLAG); } catch { /* private mode */ }
};
export const rememberFlag = () => { try { return localStorage.getItem(REMEMBER_FLAG) === '1'; } catch { return false; } };

/** Forget everything about "stay logged in" on this device (logout, or the server said no). */
export async function forgetDeviceLogin() {
  setRememberFlag(false);
  await dropDeviceKey();
}

let inFlight: Promise<'ok' | 'refused' | 'unavailable'> | null = null;

/**
 * Log in again with the device key: ask for a challenge, sign it, hand it in. One attempt at a time (several parts of the page
 * may notice the lost session together). 'refused' = the server said no (the key is useless now); 'unavailable' = no key here or no network.
 */
export function resumeWithDeviceKey(): Promise<'ok' | 'refused' | 'unavailable'> {
  inFlight ??= (async () => {
    try {
      if (!deviceKeySupported()) return 'unavailable' as const;
      const record = await run<KeyRecord | undefined>('readonly', s => s.get(RECORD));
      if (!record) return 'unavailable' as const;
      const c = await fetch('/api/auth/resume/challenge', { method: 'POST' });
      if (!c.ok) return c.status === 429 || c.status >= 500 ? ('unavailable' as const) : ('refused' as const);
      const { challenge } = await c.json();
      const message = `webmail-resume|v1|${record.keyId}|${challenge}`;
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.privateKey, new TextEncoder().encode(message));
      const r = await fetch('/api/auth/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge, signature: b64url(new Uint8Array(sig)) }) });
      if (r.ok) return 'ok' as const;
      return r.status === 429 || r.status >= 500 ? ('unavailable' as const) : ('refused' as const);
    } catch {
      return 'unavailable' as const;
    } finally {
      setTimeout(() => { inFlight = null; }, 0);
    }
  })();
  return inFlight;
}
