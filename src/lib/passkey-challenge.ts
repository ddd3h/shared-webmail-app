// In-memory WebAuthn challenge store (single-server MVP)
// Challenges expire after 5 minutes; store is capped to prevent memory DoS.

type ChallengeEntry = { challenge: string; expires: number };

const MAX_STORE_SIZE = 500;
const TTL_MS = 5 * 60 * 1000;

const store = new Map<string, ChallengeEntry>();

function cleanup() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now > v.expires) store.delete(k);
  }
}

export function storeChallenge(key: string, challenge: string): boolean {
  cleanup();
  if (store.size >= MAX_STORE_SIZE) {
    // Store is full even after TTL cleanup — reject to prevent memory exhaustion.
    return false;
  }
  store.set(key, { challenge, expires: Date.now() + TTL_MS });
  return true;
}

export function consumeChallenge(key: string): string | null {
  const entry = store.get(key);
  store.delete(key);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.challenge;
}
