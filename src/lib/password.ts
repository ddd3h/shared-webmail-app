import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

// Format: scrypt$N$r$dklen$salt$b64hash
export async function hashPassword(
  password: string,
  opts?: { N?: number; r?: number; dkLen?: number }
): Promise<string> {
  const salt = randomBytes(16);
  const N = opts?.N ?? 16384; // 2^14
  const r = opts?.r ?? 8;
  const p = 1;
  const dkLen = opts?.dkLen ?? 64;

  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, dkLen, { N, r, p }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

  return `scrypt$${N}$${r}$${dkLen}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length < 6 || parts[0] !== 'scrypt') return false;
    const [, sN, sr, sdkLen, ssalt, shash] = parts;
    const N = parseInt(sN, 10);
    const r = parseInt(sr, 10);
    const dkLen = parseInt(sdkLen, 10);
    const salt = Buffer.from(ssalt, 'base64');
    const hash = Buffer.from(shash, 'base64');

    const calc = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, dkLen, { N, r, p: 1 }, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });

    return timingSafeEqual(calc, hash);
  } catch {
    return false;
  }
}
