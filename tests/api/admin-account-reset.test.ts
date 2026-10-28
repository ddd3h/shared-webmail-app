import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    users: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    passkey_credentials: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  },
}));
vi.mock('@/lib/finance-guard', () => ({ adminActor: vi.fn(), forbidden: vi.fn(() => NextResponse.json({ error: 'forbidden' }, { status: 403 })) }));
vi.mock('@/lib/auth', () => ({ revokeUserSessions: vi.fn().mockResolvedValue(3) }));
vi.mock('@/lib/mfa', () => ({ clearTotp: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: vi.fn() }));
vi.mock('@/lib/mattermost-dm', () => ({ sendDirectMessage: vi.fn() }));
vi.mock('@/lib/password-reset-token', () => ({ issueResetToken: vi.fn().mockResolvedValue('RAWTOKEN'), resetUrl: vi.fn((t: string) => `https://mail.example.com/reset-password?token=${t}`) }));

import { POST as resetAll } from '@/app/api/admin/security/users/[id]/reset-all/route';
import { POST as notify } from '@/app/api/admin/security/notify/route';
import { prisma } from '@/lib/db';
import { adminActor } from '@/lib/finance-guard';
import { revokeUserSessions } from '@/lib/auth';
import { clearTotp } from '@/lib/mfa';
import { sendDirectMessage } from '@/lib/mattermost-dm';
import { logAudit } from '@/lib/audit';

const db = prisma as any;
const target = { id: 'u-target', name: '山田 太郎', email: 'yamada@example.com' };
const resetReq = () => new NextRequest('http://localhost/api/admin/security/users/u-target/reset-all', { method: 'POST' });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const notifyReq = (body: unknown) => new NextRequest('http://localhost/api/admin/security/notify', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  (adminActor as any).mockResolvedValue({ id: 'u-admin' });
  db.users.findUnique.mockResolvedValue(target);
  db.passkey_credentials.deleteMany.mockResolvedValue({ count: 2 });
  (revokeUserSessions as any).mockResolvedValue(3);
  (sendDirectMessage as any).mockResolvedValue(true);
});

describe('管理者によるアカウントの全リセット', () => {
  it('管理者以外は403で、何も消さない', async () => {
    (adminActor as any).mockResolvedValue(null);
    const res = await resetAll(resetReq(), params('u-target'));
    expect(res.status).toBe(403);
    expect(db.passkey_credentials.deleteMany).not.toHaveBeenCalled();
    expect(clearTotp).not.toHaveBeenCalled();
  });

  it('自分自身はリセットできない（409）', async () => {
    db.users.findUnique.mockResolvedValue({ ...target, id: 'u-admin' });
    const res = await resetAll(resetReq(), params('u-admin'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'reset_self' });
    expect(db.passkey_credentials.deleteMany).not.toHaveBeenCalled();
  });

  it('存在しない人は404', async () => {
    db.users.findUnique.mockResolvedValue(null);
    expect((await resetAll(resetReq(), params('nobody'))).status).toBe(404);
  });

  it('パスキー・2段階認証・パスワードを消し、セッションを終えて、再設定リンクをDMで送る。リンクは管理者に見せない', async () => {
    const res = await resetAll(resetReq(), params('u-target'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(db.passkey_credentials.deleteMany).toHaveBeenCalledWith({ where: { user_id: 'u-target' } });
    expect(clearTotp).toHaveBeenCalledWith('u-target');
    expect(db.users.update).toHaveBeenCalledWith({ where: { id: 'u-target' }, data: { password_hash: null } });
    expect(revokeUserSessions).toHaveBeenCalledWith('u-target');
    expect(sendDirectMessage).toHaveBeenCalledWith('u-target', 'yamada@example.com', expect.stringContaining('token=RAWTOKEN'), 'security_admin_reset');
    expect(body).toMatchObject({ ok: true, ended: 3, passkeys_removed: 2, delivered: true });
    expect(body).not.toHaveProperty('reset_url');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'u-admin', actionType: 'account_reset_all', targetId: 'u-target' }));
  });

  it('DMを送れなかったときだけ、再設定リンクを管理者に返す', async () => {
    (sendDirectMessage as any).mockResolvedValue(false);
    const body = await (await resetAll(resetReq(), params('u-target'))).json();
    expect(body).toMatchObject({ ok: true, delivered: false, reset_url: 'https://mail.example.com/reset-password?token=RAWTOKEN' });
  });
});

describe('管理者が手で送るMattermostのお知らせ', () => {
  it('管理者以外は403で、送らない', async () => {
    (adminActor as any).mockResolvedValue(null);
    const res = await notify(notifyReq({ userIds: ['u1'], message: 'こんにちは' }));
    expect(res.status).toBe(403);
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });

  it('宛先なし・本文なし・長すぎる本文は400', async () => {
    expect((await notify(notifyReq({ userIds: [], message: 'a' }))).status).toBe(400);
    expect((await notify(notifyReq({ userIds: ['u1'], message: '   ' }))).status).toBe(400);
    expect((await notify(notifyReq({ userIds: ['u1'], message: 'a'.repeat(2001) }))).status).toBe(400);
  });

  it('選んだ人それぞれにDMを送り、送れた人数を返す。1人の失敗で止まらない', async () => {
    db.users.findMany.mockResolvedValue([{ id: 'u1', name: 'A', email: 'a@example.com' }, { id: 'u2', name: 'B', email: 'b@example.com' }]);
    (sendDirectMessage as any).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await notify(notifyReq({ userIds: ['u1', 'u2', 'u1'], message: ' パスキーを1つにしてください ' }));
    const body = await res.json();
    expect(sendDirectMessage).toHaveBeenCalledTimes(2);
    expect(sendDirectMessage).toHaveBeenCalledWith('u1', 'a@example.com', expect.stringContaining('パスキーを1つにしてください'), 'admin_manual');
    expect(body).toMatchObject({ ok: true, found: 2, delivered: 1 });
    expect(body.results).toEqual([{ id: 'u1', name: 'A', delivered: false }, { id: 'u2', name: 'B', delivered: true }]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'admin_manual_dm', metadata: expect.objectContaining({ recipients: 2, delivered: 1 }) }));
  });
});
