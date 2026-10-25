import type { NextRequest } from 'next/server';
import { clientIpFrom } from '@/lib/client-ip';

interface Entry {
  count: number;
  resetAt: number;
}

// Survive hot-reload in development without duplicating state
const g = globalThis as any;
if (!g.__rateLimitStore) g.__rateLimitStore = new Map<string, Entry>();
const store: Map<string, Entry> = g.__rateLimitStore;

function cleanup() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now > v.resetAt) store.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  /** True only on the first request that exceeds the limit — use to trigger a one-shot alert. */
  isFirstBlock: boolean;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (store.size > 50_000) cleanup();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0, isFirstBlock: false };
  }

  entry.count++;

  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
      isFirstBlock: entry.count === limit + 1,
    };
  }

  return { allowed: true, remaining: limit - entry.count, retryAfterSec: 0, isFirstBlock: false };
}

export function resetRateLimit(key: string) {
  store.delete(key);
}

/** The caller's address (see client-ip.ts for why the X-Forwarded-For header is not taken at face value). */
export function getClientIp(req: NextRequest): string {
  return clientIpFrom(name => req.headers.get(name));
}
