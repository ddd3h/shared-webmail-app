import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Iron from 'iron-webcrypto';

// Mock iron-webcrypto
vi.mock('iron-webcrypto', () => ({
  seal: vi.fn(),
  unseal: vi.fn(),
  defaults: { ttl: 0 }
}));

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn()
}));

import { requireAuth } from '@/lib/auth';

describe('Auth Library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireAuth', () => {
    it('セッションがある場合は何も起きない', () => {
      const session = { userId: 'u1', email: 'e1', role: 'user', lastActivity: Date.now() };
      expect(() => requireAuth(session)).not.toThrow();
    });

    it('セッションがない場合は 401 エラーを投げる', () => {
      expect(() => requireAuth(null)).toThrow();
      try {
        requireAuth(null);
      } catch (e: any) {
        expect(e.status).toBe(401);
        expect(e.message).toBe('Unauthorized');
      }
    });
  });

  // Note: sealSession/unsealToken are private/unexported in the current implementation,
  // but they are used by getSession and others. 
  // If we want to test them, we might need to export them or test through public APIs.
  // Currently we focus on what's available and critical.
});
