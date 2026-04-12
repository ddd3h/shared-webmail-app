// Symmetric encryption for mailbox credentials
import { webcrypto } from 'crypto';

const subtle = webcrypto.subtle;

function getKeyBytes(): Uint8Array {
  const hex = process.env.ENCRYPTION_KEY_HEX || '';
  if (!/^([0-9a-fA-F]{2}){32}$/.test(hex)) throw new Error('ENCRYPTION_KEY_HEX must be 32 bytes hex');
  return Buffer.from(hex, 'hex');
}

export async function getAesKey(): Promise<CryptoKey> {
  const keyBytes = getKeyBytes();
  return subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(text: string): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await getAesKey();
  const enc = new TextEncoder().encode(text);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
  return Buffer.concat([Buffer.from(iv), Buffer.from(new Uint8Array(ct))]).toString('base64');
}

export async function decrypt(b64: string): Promise<string> {
  const raw = Buffer.from(b64, 'base64');
  const iv = raw.subarray(0, 12);
  const data = raw.subarray(12);
  const key = await getAesKey();
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(pt);
}

