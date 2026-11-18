import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    mattermost_channels: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    users: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/finance-guard', () => ({ adminActor: vi.fn(), forbidden: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ listPeople: vi.fn(async () => []) }));

import { prisma } from '@/lib/db';
import { adminActor } from '@/lib/finance-guard';
import { usableChannels } from '@/lib/mattermost-channels';
import { POST } from '@/app/api/admin/mattermost-channels/route';

const post = (b: object) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }) as any);
beforeEach(() => vi.resetAllMocks());

describe('usableChannels', () => {
  it('管理者でない人には、公開と、自分が選ばれている非公開だけ', async () => {
    (prisma.mattermost_channels.findMany as any).mockResolvedValue([]);
    await usableChannels('u1', 'user');
    expect((prisma.mattermost_channels.findMany as any).mock.calls[0][0].where).toEqual({ OR: [{ visibility: 'public' }, { users: { some: { user_id: 'u1' } } }] });
  });
  it('管理者には全部', async () => {
    (prisma.mattermost_channels.findMany as any).mockResolvedValue([]);
    await usableChannels('a', 'admin');
    expect((prisma.mattermost_channels.findMany as any).mock.calls[0][0].where).toEqual({});
  });
});

describe('POST /api/admin/mattermost-channels', () => {
  const body = { channel_id: 'c1', name: '営業', visibility: 'private', user_ids: ['u1', 'ghost'] };
  it('管理者でなければ403', async () => {
    (adminActor as any).mockResolvedValue(null);
    expect((await post(body)).status).toBe(403);
    expect(prisma.mattermost_channels.create).not.toHaveBeenCalled();
  });
  it('同じチャンネルIDは409', async () => {
    (adminActor as any).mockResolvedValue({ id: 'a' });
    (prisma.mattermost_channels.findUnique as any).mockResolvedValue({ id: 'x' });
    expect((await post(body)).status).toBe(409);
  });
  it('非公開は、実在する人だけを入れて作る', async () => {
    (adminActor as any).mockResolvedValue({ id: 'a' });
    (prisma.mattermost_channels.findUnique as any).mockResolvedValue(null);
    (prisma.users.findMany as any).mockResolvedValue([{ id: 'u1' }]);
    (prisma.mattermost_channels.create as any).mockResolvedValue({ id: 'n1' });
    expect((await post(body)).status).toBe(200);
    expect((prisma.mattermost_channels.create as any).mock.calls[0][0].data.users).toEqual({ create: [{ user_id: 'u1' }] });
  });
  it('公開なら人は入れない', async () => {
    (adminActor as any).mockResolvedValue({ id: 'a' });
    (prisma.mattermost_channels.findUnique as any).mockResolvedValue(null);
    (prisma.mattermost_channels.create as any).mockResolvedValue({ id: 'n1' });
    await post({ ...body, visibility: 'public' });
    expect(prisma.users.findMany).not.toHaveBeenCalled();
    expect((prisma.mattermost_channels.create as any).mock.calls[0][0].data.users).toEqual({ create: [] });
  });
});
