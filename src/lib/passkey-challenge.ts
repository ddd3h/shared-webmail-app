// In-memory WebAuthn challenge store (single-server MVP)
// Challenges expire after 5 minutes

type ChallengeEntry = { challenge: string; expires: number };

const store = new Map<string, ChallengeEntry>();

function cleanup() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now > v.expires) store.delete(k);
  }
}

export function storeChallenge(key: string, challenge: string) {
  cleanup();
  store.set(key, { challenge, expires: Date.now() + 5 * 60 * 1000 });
}

export function consumeChallenge(key: string): string | null {
  const entry = store.get(key);
  store.delete(key);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.challenge;
}
