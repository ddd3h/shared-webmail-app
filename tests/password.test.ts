import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';

describe('password', () => {
  it('hash and verify', async () => {
    const h = await hashPassword('passw0rd');
    expect(await verifyPassword('passw0rd', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

