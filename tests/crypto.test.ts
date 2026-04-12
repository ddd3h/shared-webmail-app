import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '@/lib/crypto';

process.env.ENCRYPTION_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('crypto', () => {
  it('encrypt/decrypt roundtrip', async () => {
    const plain = 'secret-password-1234';
    const enc = await encrypt(plain);
    expect(enc).not.toBe(plain);
    const dec = await decrypt(enc);
    expect(dec).toBe(plain);
  });
});

