import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { draft_attachments: { findMany: vi.fn(async () => []) }, users: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u2', role: 'user' })), requireAuth: vi.fn() }));
vi.mock('@/lib/draft-access', () => ({ checkAccess: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ draftTargetOk: vi.fn() }));
vi.mock('@/lib/attachment-storage', () => ({ deleteStoredFiles: vi.fn() }));

import { prisma } from '@/lib/db';
import { checkAccess } from '@/lib/draft-access';
import { GET } from '@/app/api/drafts/[id]/route';

const get = () => GET(new Request('http://x') as any, { params: Promise.resolve({ id: 'd1' }) });
beforeEach(() => vi.clearAllMocks());

describe('GET /api/drafts/:id の作成者の署名', () => {
  it('共有の下書きは、開いた人ではなく作った人の署名を返す', async () => {
    (checkAccess as any).mockResolvedValue({ draft: { id: 'd1', user_id: 'u1', is_shared: true, yjs_state: null }, accessible: true });
    (prisma.users.findUnique as any).mockResolvedValue({ name: '田中', email: 't@x.jp', signature: null });
    const j = await (await get()).json();
    expect((prisma.users.findUnique as any).mock.calls[0][0].where).toEqual({ id: 'u1' });
    expect(j.creator_signature).toBe('田中\nt@x.jp');
  });
  it('自分の署名を設定済みなら、それを返す。共有でない下書きには付けない', async () => {
    (checkAccess as any).mockResolvedValue({ draft: { id: 'd1', user_id: 'u1', is_shared: true, yjs_state: null }, accessible: true });
    (prisma.users.findUnique as any).mockResolvedValue({ name: '田中', email: 't@x.jp', signature: '田中 太郎' });
    expect((await (await get()).json()).creator_signature).toBe('田中 太郎');
    (checkAccess as any).mockResolvedValue({ draft: { id: 'd1', user_id: 'u1', is_shared: false, yjs_state: null }, accessible: true });
    expect((await (await get()).json()).creator_signature).toBeNull();
  });
});
