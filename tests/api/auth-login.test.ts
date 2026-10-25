import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    users: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    login_logs: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
  },
}));
vi.mock('@/lib/password', () => ({ verifyPassword: vi.fn(), hashPassword: vi.fn(async () => 'dummy-hash') }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/dos-alert', () => ({ sendDosAlert: vi.fn() }));
vi.mock('@/lib/ip-lookup', () => ({ lookupIp: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/login-log', () => ({ logLoginAttempt: vi.fn() }));
vi.mock('@/lib/known-device', () => ({ DEVICE_COOKIE: 'did', isKnownDeviceFor: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/login-flow', () => ({ finishLogin: vi.fn(async () => NextResponse.json({ ok: true })), countryAllowed: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/ip-block', () => ({ isIpBlocked: vi.fn().mockResolvedValue(false), blockIp: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/security-settings', () => ({ loadSecurityPolicy: vi.fn().mockResolvedValue({ allowedRules: [], allowedCountries: [], sessionMaxDays: 14, newDeviceAlert: true, deviceBinding: true }) }));
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: vi.fn() }));
vi.mock('@/lib/work-notify', () => ({ notifyLoginLockout: vi.fn() }));

import { POST } from '@/app/api/auth/login/route';
import { prisma } from '@/lib/db';
import { verifyPassword, hashPassword } from '@/lib/password';
import { finishLogin, countryAllowed } from '@/lib/login-flow';
import { logLoginAttempt } from '@/lib/login-log';
import { isKnownDeviceFor } from '@/lib/known-device';
import { blockIp, isIpBlocked } from '@/lib/ip-block';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { notifyLoginLockout } from '@/lib/work-notify';

const db = prisma as any;
let n = 0;
// every test gets its own address and account so the in-memory limiters of one test never leak into another
const fresh = () => { n++; return { ip: `203.0.113.${n}`, email: `user${n}@example.com` }; };

const req = (body: unknown, ip: string, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0', 'content-type': 'application/json', ...headers } });
const user = (email: string, o: object = {}) => ({ id: 'u1', email, password_hash: 'hash', role: 'user', locked_at: null, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  db.login_logs.count.mockResolvedValue(0);
  (isIpBlocked as any).mockResolvedValue(false);
  (isKnownDeviceFor as any).mockResolvedValue(false);
  (countryAllowed as any).mockResolvedValue(true);
  (finishLogin as any).mockImplementation(async () => NextResponse.json({ ok: true }));
});

describe('ログイン: 成功', () => {
  it('正しいメールアドレスとパスワードなら、ログインを完了する', async () => {
    const { ip, email } = fresh();
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(true);
    const res = await POST(req({ email, password: 'correct-password' }, ip));
    expect(res.status).toBe(200);
    expect(verifyPassword).toHaveBeenCalledWith('correct-password', 'hash');
    expect(finishLogin).toHaveBeenCalledWith(expect.anything(), { id: 'u1', email, role: 'user' }, expect.objectContaining({ method: 'password', ip }));
  });

  it('メールアドレスは前後の空白と大文字小文字を無視して探す', async () => {
    const { ip, email } = fresh();
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(true);
    await POST(req({ email: `  ${email.toUpperCase()} `, password: 'pw' }, ip));
    expect(db.users.findFirst).toHaveBeenCalledWith({ where: { email: { equals: email, mode: 'insensitive' } } });
  });
});

describe('ログイン: 失敗は常に同じ答え', () => {
  it('パスワード違い・存在しないアカウント・ロック中は、同じ401。理由は内部の記録にだけ残る', async () => {
    const results: { status: number; body: unknown }[] = [];
    const cases: [object | null, boolean, string][] = [[null, false, 'user_not_found'], [{}, false, 'wrong_password'], [{ locked_at: new Date() }, true, 'account_locked']];
    for (const [extra, passwordOk, reason] of cases) {
      const { ip, email } = fresh();
      db.users.findFirst.mockResolvedValue(extra === null ? null : user(email, extra));
      (verifyPassword as any).mockResolvedValue(passwordOk);
      const res = await POST(req({ email, password: 'x' }, ip));
      results.push({ status: res.status, body: await res.json() });
      expect(logLoginAttempt).toHaveBeenLastCalledWith(expect.objectContaining({ success: false, failureReason: reason }));
    }
    expect(new Set(results.map(r => JSON.stringify(r))).size).toBe(1);
    expect(results[0]).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(finishLogin).not.toHaveBeenCalled();
  });

  it('存在しないアカウントでも、パスワードの検証と同じ重さの処理をする（応答時間で見分けさせない）', async () => {
    const { ip, email } = fresh();
    db.users.findFirst.mockResolvedValue(null);
    (verifyPassword as any).mockResolvedValue(true); // even a "match" against the dummy must not log anyone in
    const res = await POST(req({ email, password: 'whatever' }, ip));
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(verifyPassword).toHaveBeenCalledWith('whatever', 'dummy-hash');
    expect(res.status).toBe(401);
    expect(finishLogin).not.toHaveBeenCalled();
  });

  it('許可されていない国からは、パスワードが合っていても同じ401（合っていることを教えない）', async () => {
    const { ip, email } = fresh();
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(true);
    (countryAllowed as any).mockResolvedValue(false);
    const res = await POST(req({ email, password: 'right' }, ip));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(finishLogin).not.toHaveBeenCalled();
  });
});

describe('ログイン: 不正な入力', () => {
  const bad: [string, unknown][] = [['emailなし', { password: 'x' }], ['passwordなし', { email: 'a@b.c' }], ['passwordが文字列でない', { email: 'a@b.c', password: { $ne: '' } }], ['passwordが空', { email: 'a@b.c', password: '' }], ['passwordが長すぎる', { email: 'a@b.c', password: 'x'.repeat(1001) }], ['emailが配列', { email: ['a@b.c'], password: 'x' }], ['本文が壊れている', 'not json']];
  for (const [label, body] of bad) {
    it(`${label}は400で、DBも触らない`, async () => {
      const { ip } = fresh();
      const r = new NextRequest('http://localhost/api/auth/login', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'x-forwarded-for': ip } });
      expect((await POST(r)).status).toBe(400);
      expect(db.users.findFirst).not.toHaveBeenCalled();
    });
  }
});

describe('ログイン: ブロック・ネットワーク制限', () => {
  it('ブロック中のアドレスは、アカウントを調べる前に403', async () => {
    const { ip, email } = fresh();
    (isIpBlocked as any).mockResolvedValue(true);
    const res = await POST(req({ email, password: 'x' }, ip));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'access_denied' });
    expect(db.users.findFirst).not.toHaveBeenCalled();
    expect(logLoginAttempt).toHaveBeenCalledWith(expect.objectContaining({ failureReason: 'ip_blocked' }));
  });

  it('許可ネットワークが設定されていて、外のアドレスなら403。中のアドレスは通る', async () => {
    (loadSecurityPolicy as any).mockResolvedValue({ allowedRules: ['198.51.100.0/24'], allowedCountries: [], sessionMaxDays: 14, newDeviceAlert: true, deviceBinding: true });
    try {
      const outside = fresh();
      expect((await POST(req({ email: outside.email, password: 'x' }, outside.ip))).status).toBe(403);
      const inside = fresh();
      db.users.findFirst.mockResolvedValue(user(inside.email));
      (verifyPassword as any).mockResolvedValue(true);
      expect((await POST(req({ email: inside.email, password: 'x' }, '198.51.100.20'))).status).toBe(200);
    } finally {
      (loadSecurityPolicy as any).mockResolvedValue({ allowedRules: [], allowedCountries: [], sessionMaxDays: 14, newDeviceAlert: true, deviceBinding: true });
    }
  });
});

describe('ログイン: 試行回数の制限', () => {
  async function fail(ip: string, email: string) {
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(false);
    return POST(req({ email, password: 'wrong' }, ip));
  }

  it('同じアカウントを同じアドレスから5回までは401、6回目は429（Retry-After つき）', async () => {
    const { ip, email } = fresh();
    for (let i = 0; i < 5; i++) expect((await fail(ip, email)).status).toBe(401);
    const res = await fail(ip, email);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(logLoginAttempt).toHaveBeenLastCalledWith(expect.objectContaining({ failureReason: 'rate_limited_account_ip' }));
  });

  it('制限中は、正しいパスワードでも通さない', async () => {
    const { ip, email } = fresh();
    for (let i = 0; i < 6; i++) await fail(ip, email);
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(true);
    expect((await POST(req({ email, password: 'right' }, ip))).status).toBe(429);
    expect(finishLogin).not.toHaveBeenCalled();
  });

  it('他人が別のアドレスから失敗を重ねても、本人の端末（Cookieあり）は締め出されない', async () => {
    const { email } = fresh();
    for (let i = 0; i < 15; i++) await fail(`198.18.${i}.1`, email); // an attacker spread over many addresses
    expect((await fail('198.18.99.1', email)).status).toBe(429); // an unknown browser is stopped
    (isKnownDeviceFor as any).mockResolvedValue(true);
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(true);
    expect((await POST(req({ email, password: 'right' }, '203.0.113.250'))).status).toBe(200); // the person's own browser still works
  });

  it('DBに残った失敗が多ければ、再起動しても制限が続く', async () => {
    const { ip, email } = fresh();
    db.login_logs.count.mockResolvedValue(40);
    const res = await fail(ip, email);
    expect(res.status).toBe(429);
    expect(logLoginAttempt).toHaveBeenLastCalledWith(expect.objectContaining({ failureReason: 'rate_limited_account_persisted' }));
  });

  it('制限に初めて達したとき、本人（存在するアカウント）に知らせる。同じ制限中は何度も送らない', async () => {
    const { ip, email } = fresh();
    for (let i = 0; i < 5; i++) await fail(ip, email);
    await fail(ip, email);
    await fail(ip, email);
    expect(notifyLoginLockout).toHaveBeenCalledTimes(1);
  });

  it('成功すると、そのアカウントとアドレスの失敗回数は数え直し', async () => {
    const { ip, email } = fresh();
    for (let i = 0; i < 4; i++) await fail(ip, email);
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(true);
    expect((await POST(req({ email, password: 'right' }, ip))).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await fail(ip, email)).status).toBe(401);
  });

  it('アドレス単位は20回まで。超えると429になり、繰り返すとアドレスが自動ブロックされる', async () => {
    const ip = `192.0.2.${++n}`;
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) last = await fail(ip, `spray${n}-${i % 7}@example.com`); // 7 accounts, so the sweep rule (8+) doesn't fire first
    expect(last!.status).toBe(429);
    expect(blockIp).not.toHaveBeenCalled(); // first strike
  });

  it('X-Forwarded-For の左端に偽の値を書いても、制限は右端（自分のプロキシが記録した値）で数える', async () => {
    const real = `203.0.113.${100 + ++n}`;
    const email = `spoof${n}@example.com`;
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(false);
    let status = 0;
    for (let i = 0; i < 6; i++) status = (await POST(req({ email, password: 'x' }, `10.${i}.0.1, ${real}`))).status;
    expect(status).toBe(429);
  });
});

describe('ログイン: スイーピング（1つのアドレスが多数のアカウントを試す）', () => {
  it('短時間に9個目の別アカウントを試すと、アドレスを自動ブロックして403', async () => {
    const ip = `192.0.2.${++n}`;
    db.users.findFirst.mockResolvedValue(null);
    (verifyPassword as any).mockResolvedValue(false);
    for (let i = 0; i < 8; i++) expect((await POST(req({ email: `victim${n}-${i}@example.com`, password: 'x' }, ip))).status).toBe(401);
    const res = await POST(req({ email: `victim${n}-9@example.com`, password: 'x' }, ip));
    expect(res.status).toBe(403);
    expect(blockIp).toHaveBeenCalledWith(expect.objectContaining({ ip, source: 'auto' }));
  });

  it('同じアカウントを何度試しても、別アカウントの数にはならない', async () => {
    const { ip, email } = fresh();
    db.users.findFirst.mockResolvedValue(user(email));
    (verifyPassword as any).mockResolvedValue(false);
    for (let i = 0; i < 5; i++) await POST(req({ email, password: 'x' }, ip));
    expect(blockIp).not.toHaveBeenCalled();
  });
});
