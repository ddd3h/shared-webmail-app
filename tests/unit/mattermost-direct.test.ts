import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    users: { findUnique: vi.fn(), update: vi.fn() },
    mattermost_notifications: { create: vi.fn() },
  },
}));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }));

import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { sendDirectMessage } from '@/lib/mattermost-dm';

const ok = (body: unknown) => ({ ok: true, json: async () => body, text: async () => '' });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}), text: async () => 'nope' });

beforeEach(() => {
  vi.resetAllMocks();
  (getSetting as any).mockImplementation(async (k: string) => (k === 'MATTERMOST_BASE_URL' ? 'https://mm.example.com/' : 'tok'));
  (prisma.users.findUnique as any).mockResolvedValue({ mattermost_user_id: 'mmu1' });
  (prisma.mattermost_notifications.create as any).mockResolvedValue({});
});

describe('sendDirectMessage', () => {
  it('Mattermost未設定なら何もせずfalse', async () => {
    (getSetting as any).mockResolvedValue(null);
    expect(await sendDirectMessage('u1', 'a@example.com', 'hi', 't')).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('DMチャンネルを作って投稿し、履歴を残す', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(ok({ id: 'bot1' }))      // /users/me
      .mockResolvedValueOnce(ok({ id: 'ch1' }))       // /channels/direct
      .mockResolvedValueOnce(ok({ id: 'post1' }));    // /posts
    expect(await sendDirectMessage('u1', 'a@example.com', 'こんにちは', 'expense_submitted')).toBe(true);
    const calls = (global.fetch as any).mock.calls;
    expect(calls[2][0]).toBe('https://mm.example.com/api/v4/posts');
    expect(JSON.parse(calls[2][1].body)).toEqual({ channel_id: 'ch1', message: 'こんにちは' });
    expect((prisma.mattermost_notifications.create as any).mock.calls[0][0].data).toMatchObject({ notification_type: 'expense_submitted', status: 'success' });
  });
  it('API失敗でも例外を投げず、失敗として記録する', async () => {
    (global.fetch as any).mockResolvedValue(fail(500));
    expect(await sendDirectMessage('u1', 'a@example.com', 'x', 'expense_submitted')).toBe(false);
    expect((prisma.mattermost_notifications.create as any).mock.calls[0][0].data).toMatchObject({ status: 'failed' });
  });
  it('Mattermostにユーザーがいなければ静かにfalse', async () => {
    (prisma.users.findUnique as any).mockResolvedValue({ mattermost_user_id: null });
    (global.fetch as any).mockResolvedValue(fail(404));
    expect(await sendDirectMessage('u1', 'a@example.com', 'x', 't')).toBe(false);
    expect(prisma.mattermost_notifications.create).not.toHaveBeenCalled();
  });
});
