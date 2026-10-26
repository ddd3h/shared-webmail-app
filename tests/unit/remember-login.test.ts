import { describe, it, expect } from 'vitest';
import { webcrypto } from 'crypto';
import { consumeChallenge, issueChallenge, parseDevicePublicKey, resumeMessage, verifyDeviceSignature } from '@/lib/remember-login';

const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');

// what the installed app does in the browser (src/lib/device-key.ts), done here with Node's WebCrypto
async function device() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const spki = b64url(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  const sign = async (m: string) => b64url(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(m)));
  return { spki, sign, pair };
}

describe('端末の公開鍵', () => {
  it('P-256 の鍵を受け入れ、sha256 を「端末の個体番号」(key_id) にする', async () => {
    const d = await device();
    const k = await parseDevicePublicKey(d.spki);
    expect(k?.spki).toBe(d.spki);
    expect(k?.keyId).toMatch(/^[0-9a-f]{64}$/);
    expect((await parseDevicePublicKey(d.spki))?.keyId).toBe(k?.keyId); // the same key, the same number
    expect((await parseDevicePublicKey((await device()).spki))?.keyId).not.toBe(k?.keyId);
  });
  it('秘密鍵はエクスポートできない（端末の外に出せない）', async () => {
    const d = await device();
    expect(d.pair.privateKey.extractable).toBe(false);
    await expect(webcrypto.subtle.exportKey('pkcs8', d.pair.privateKey)).rejects.toThrow();
  });
  it('鍵でないもの・長すぎるもの・別の曲線は拒否する', async () => {
    for (const bad of [null, undefined, '', 'abc', 'x'.repeat(300), 'not base64!', Buffer.alloc(91).toString('base64url')]) expect(await parseDevicePublicKey(bad as string)).toBeNull();
    const p384 = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify']);
    expect(await parseDevicePublicKey(b64url(await webcrypto.subtle.exportKey('spki', p384.publicKey)))).toBeNull();
  });
});

describe('署名の確認', () => {
  it('その鍵で、そのメッセージに署名したものだけ通す', async () => {
    const d = await device();
    const msg = resumeMessage('abc', 'challenge-1');
    expect(await verifyDeviceSignature(d.spki, msg, await d.sign(msg))).toBe(true);
    expect(await verifyDeviceSignature(d.spki, resumeMessage('abc', 'challenge-2'), await d.sign(msg))).toBe(false); // another challenge
    expect(await verifyDeviceSignature(d.spki, resumeMessage('xyz', 'challenge-1'), await d.sign(msg))).toBe(false); // another device number
    expect(await verifyDeviceSignature((await device()).spki, msg, await d.sign(msg))).toBe(false); // another device's key
  });
  it('壊れた署名・形の違う署名は false（例外にしない）', async () => {
    const d = await device();
    for (const bad of [undefined, null, 42, '', 'zzz!', 'A'.repeat(10), 'A'.repeat(300), Buffer.alloc(64).toString('base64url'), Buffer.alloc(65).toString('base64url')]) {
      expect(await verifyDeviceSignature(d.spki, 'm', bad), String(bad)).toBe(false);
    }
  });
});

describe('チャレンジ', () => {
  it('1回だけ使える', async () => {
    const c = await issueChallenge('203.0.113.5');
    expect(await consumeChallenge(c, '203.0.113.5')).toBe(true);
    expect(await consumeChallenge(c, '203.0.113.5')).toBe(false);
  });
  it('頼んだのと別のアドレスからは使えない', async () => {
    const c = await issueChallenge('203.0.113.5');
    expect(await consumeChallenge(c, '198.51.100.9')).toBe(false);
  });
  it('偽物・壊れたものは使えない。毎回違う', async () => {
    expect(await consumeChallenge('x', '1.1.1.1')).toBe(false);
    expect(await consumeChallenge(undefined, '1.1.1.1')).toBe(false);
    expect(await consumeChallenge({}, '1.1.1.1')).toBe(false);
    expect(await issueChallenge('1.1.1.1')).not.toBe(await issueChallenge('1.1.1.1'));
  });
});
