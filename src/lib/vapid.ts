import { webcrypto } from 'crypto';

function b64url(buf: Buffer | Uint8Array) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function generateVapidKeys() {
  const { subtle } = webcrypto as any;
  const keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  // Export JWK to get x/y/d in base64url
  const jwkPub = await subtle.exportKey('jwk', keyPair.publicKey);
  const jwkPrv = await subtle.exportKey('jwk', keyPair.privateKey);
  const x = jwkPub.x as string;
  const y = jwkPub.y as string;
  const d = jwkPrv.d as string;
  // Build uncompressed public key: 0x04 || X || Y
  const xb = Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const yb = Buffer.from(y.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const pub = Buffer.concat([Buffer.from([0x04]), xb, yb]);
  return {
    publicKey: b64url(pub),
    privateKey: d // already base64url
  };
}

