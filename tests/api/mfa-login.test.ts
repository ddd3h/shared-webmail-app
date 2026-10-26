import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/known-device', () => ({ DEVICE_COOKIE: 'did', isTrustedForMfa: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/login-flow', () => ({ finishLogin: vi.fn(async () => NextResponse.json({ ok: true })) }));
vi.mock('@/lib/security-settings', () => ({ loadSecurityPolicy: vi.fn() }));
vi.mock('@/lib/short-token', () => ({ sealShort: vi.fn(async (typ: string) => `token-for-${typ}`) }));
vi.mock('@/lib/mfa', () => ({ hasTotp: vi.fn() }));

import { continueAfterPassword } from '@/lib/login-second-step';
import { finishLogin } from '@/lib/login-flow';
import { isTrustedForMfa } from '@/lib/known-device';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { hasTotp } from '@/lib/mfa';

const req = () => new NextRequest('http://localhost/api/auth/login', { method: 'POST', headers: { cookie: 'did=abc' } });
const user = { id: 'u1', email: 'a@example.com', role: 'user', totp_secret_enc: null, totp_enabled_at: null };
const ctx = { ip: '203.0.113.5', ipInfo: null };
const policy = (o: object = {}) => (loadSecurityPolicy as any).mockResolvedValue({ require2fa: true, mfaTrustDays: 30, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  (isTrustedForMfa as any).mockResolvedValue(false);
  (hasTotp as any).mockReturnValue(true);
});

describe('パスワードの後: 2段階認証の振り分け', () => {
  it('ルールが無効なら、そのままログインを完了する', async () => {
    policy({ require2fa: false });
    const res = await continueAfterPassword(req(), user, ctx);
    expect(finishLogin).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual({ ok: true });
  });

  it('2FA未設定なら、設定画面へ進める（セッションはまだ作らない）', async () => {
    policy();
    (hasTotp as any).mockReturnValue(false);
    const body = await (await continueAfterPassword(req(), user, ctx)).json();
    expect(body).toEqual({ mfa_setup_required: true, challenge: 'token-for-mfa-setup-login' });
    expect(finishLogin).not.toHaveBeenCalled();
  });

  it('2FA設定済みなら、コード入力を求める（信頼期間も伝える）', async () => {
    policy({ mfaTrustDays: 7 });
    const body = await (await continueAfterPassword(req(), user, ctx)).json();
    expect(body).toEqual({ mfa_required: true, challenge: 'token-for-mfa-login', trust_days: 7 });
    expect(finishLogin).not.toHaveBeenCalled();
  });

  it('信頼したブラウザなら、コードを省略してログインを完了する', async () => {
    policy();
    (isTrustedForMfa as any).mockResolvedValue(true);
    await continueAfterPassword(req(), user, ctx);
    expect(isTrustedForMfa).toHaveBeenCalledWith('abc', 'u1');
    expect(finishLogin).toHaveBeenCalledOnce();
  });

  it('信頼したブラウザでも、2FA未設定の人は設定を求められる', async () => {
    policy();
    (hasTotp as any).mockReturnValue(false);
    (isTrustedForMfa as any).mockResolvedValue(true);
    expect((await (await continueAfterPassword(req(), user, ctx)).json()).mfa_setup_required).toBe(true);
  });
});
