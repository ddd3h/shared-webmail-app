import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { threads: { findUnique: vi.fn() }, mattermost_links: { upsert: vi.fn() } },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u1', role: 'user' })), requireAuth: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ canViewThread: vi.fn(async () => true) }));
vi.mock('@/lib/mattermost-channels', () => ({ usableChannel: vi.fn(), mattermostConfig: vi.fn(async () => ({ baseUrl: 'https://mm', botToken: 't' })) }));

import { prisma } from '@/lib/db';
import { usableChannel } from '@/lib/mattermost-channels';
import { POST } from '@/app/api/threads/[id]/mattermost/discuss/route';

const call = (b: object) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }) as any, { params: Promise.resolve({ id: 't1' }) });
const thread = { id: 't1', subject: 's', mailbox: { type: 'team', display_name: 'm', mattermost_channel_id: 'default-ch' }, messages: [] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  (prisma.threads.findUnique as any).mockResolvedValue(thread);
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'p1' }) }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/threads/:id/mattermost/discuss', () => {
  it('使えないチャンネルを指定すると403で、投稿しない', async () => {
    (usableChannel as any).mockResolvedValue(null);
    expect((await call({ channel_ref_id: 'private1' })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('使えるチャンネルなら、そのチャンネルに投稿する', async () => {
    (usableChannel as any).mockResolvedValue({ id: 'r1', channel_id: 'picked-ch', name: 'x', visibility: 'public' });
    expect((await call({ channel_ref_id: 'r1' })).status).toBe(200);
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).channel_id).toBe('picked-ch');
  });
  it('指定がなければ、メールボックスの既定のチャンネルに投稿する（今までどおり）', async () => {
    expect((await call({})).status).toBe(200);
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).channel_id).toBe('default-ch');
  });
});
