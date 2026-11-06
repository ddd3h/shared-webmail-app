import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// 本人確認の入れ直し: パスキーを持つ人は、パスワードではなくパスキーで確認する（パスワードではログインできない人なので）。

vi.mock('@/lib/db', () => ({
  prisma: {
    sessions: { update: vi.fn().mockResolvedValue({}) },
    passkey_credentials: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    users: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), requireAuth: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/password', () => ({ verifyPassword: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(async (o: { allowCredentials: unknown }) => ({ challenge: 'CHALLENGE', allowCredentials: o.allowCredentials })),
  verifyAuthenticationResponse: vi.fn(),
}));

import { POST as reauth } from '@/app/api/auth/reauth/route';
import { POST as options } from '@/app/api/auth/reauth/options/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { recordSecurityEvent } from '@/lib/security-events';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';

const db = prisma as any;
const req = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined, headers: { origin: 'http://localhost:3000' } });
const cred = { id: 'c1', credential_id: 'CRED', public_key: Buffer.from([1, 2, 3]), counter: BigInt(1), transports: null };

beforeEach(() => {
  vi.clearAllMocks();
  (recordSecurityEvent as any).mockResolvedValue(undefined);
  (getSession as any).mockResolvedValue({ userId: 'u1', sessionId: 's1' });
  db.users.findUnique.mockResolvedValue({ id: 'u1', password_hash: 'hash', totp_secret: null });
  (verifyPassword as any).mockResolvedValue(true);
});

describe('入れ直しの方法の案内', () => {
  it('パスキーのない人は「パスワード」', async () => {
    db.passkey_credentials.count.mockResolvedValue(0);
    expect(await (await options(req('/api/auth/reauth/options'))).json()).toEqual({ method: 'password' });
  });
  it('パスキーのある人は「パスキー」。その人のパスキーだけを指定したチャレンジが返る', async () => {
    db.passkey_credentials.count.mockResolvedValue(1);
    db.passkey_credentials.findMany.mockResolvedValue([{ credential_id: 'CRED', transports: null }]);
    const body = await (await options(req('/api/auth/reauth/options'))).json();
    expect(body.method).toBe('passkey');
    expect(body.options.challenge).toBe('CHALLENGE');
    expect(body.options.allowCredentials).toEqual([{ id: 'CRED', transports: undefined }]);
    expect(typeof body.options.challengeId).toBe('string');
    expect(db.passkey_credentials.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 'u1' } }));
  });
});

describe('POST /api/auth/reauth', () => {
  it('パスキーのない人は、パスワードで確認できる（これまでどおり）。確認できるとセッションに時刻が入る', async () => {
    db.passkey_credentials.count.mockResolvedValue(0);
    const res = await reauth(req('/api/auth/reauth', { password: 'pw' }));
    expect(res.status).toBe(200);
    expect(db.sessions.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
  });

  it('パスキーのある人は、正しいパスワードでも確認できない（パスキーで確認する）', async () => {
    db.passkey_credentials.count.mockResolvedValue(1);
    const res = await reauth(req('/api/auth/reauth', { password: 'pw' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'passkey_required' });
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(db.sessions.update).not.toHaveBeenCalled();
  });

  it('パスキーのある人: 自分のチャレンジに、自分のパスキーで署名すれば確認できる。チャレンジは1回だけ', async () => {
    db.passkey_credentials.count.mockResolvedValue(1);
    db.passkey_credentials.findMany.mockResolvedValue([{ credential_id: 'CRED', transports: null }]);
    db.passkey_credentials.findFirst.mockResolvedValue(cred);
    (verifyAuthenticationResponse as any).mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 2 } });
    const { options: o } = await (await options(req('/api/auth/reauth/options'))).json();
    const answer = { passkey: { id: 'CRED', challengeId: o.challengeId, response: {} } };

    const ok = await reauth(req('/api/auth/reauth', answer));
    expect(ok.status).toBe(200);
    expect(db.sessions.update).toHaveBeenCalledTimes(1);
    expect(db.passkey_credentials.findFirst).toHaveBeenCalledWith({ where: { credential_id: 'CRED', user_id: 'u1' } }); // 他人のパスキーは受けない
    expect(db.passkey_credentials.update).toHaveBeenCalled(); // カウンターが進む

    const again = await reauth(req('/api/auth/reauth', answer)); // 同じ答えの使い回し
    expect(again.status).toBe(400);
    expect(db.sessions.update).toHaveBeenCalledTimes(1);
  });

  it('署名が正しくない・チャレンジがない・他人のパスキーなら、確認できない', async () => {
    db.passkey_credentials.count.mockResolvedValue(1);
    db.passkey_credentials.findMany.mockResolvedValue([{ credential_id: 'CRED', transports: null }]);
    const { options: o } = await (await options(req('/api/auth/reauth/options'))).json();

    (verifyAuthenticationResponse as any).mockResolvedValue({ verified: false });
    db.passkey_credentials.findFirst.mockResolvedValue(cred);
    expect((await reauth(req('/api/auth/reauth', { passkey: { id: 'CRED', challengeId: o.challengeId } }))).status).toBe(400);

    expect((await reauth(req('/api/auth/reauth', { passkey: { id: 'CRED', challengeId: 'unknown' } }))).status).toBe(400);

    const o2 = (await (await options(req('/api/auth/reauth/options'))).json()).options;
    db.passkey_credentials.findFirst.mockResolvedValue(null); // その人のものではないパスキー
    expect((await reauth(req('/api/auth/reauth', { passkey: { id: 'OTHERS', challengeId: o2.challengeId } }))).status).toBe(400);
    expect(db.sessions.update).not.toHaveBeenCalled();
  });
});
