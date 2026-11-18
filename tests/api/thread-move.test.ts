import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    threads: { findUnique: vi.fn(), update: vi.fn() },
    messages: { updateMany: vi.fn() },
    mailboxes: { findUnique: vi.fn() },
    $transaction: vi.fn(async () => []),
  },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u1', role: 'user' })), requireAuth: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ canViewMailbox: vi.fn() }));

import { prisma } from '@/lib/db';
import { canViewMailbox } from '@/lib/rbac';
import { POST } from '@/app/api/threads/[id]/move/route';

const move = (target: string) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ target_mailbox_id: target }) }) as any, { params: Promise.resolve({ id: 't1' }) });
const thread = (mb: object, assigned: string | null = null) => ({ id: 't1', mailbox_id: (mb as any).id, mailbox: mb, assigned_user_id: assigned, messages: [{ id: 'm1' }] });
const members = (ids: Record<string, string[]>) => (canViewMailbox as any).mockImplementation(async (u: string, mb: string) => (ids[mb] ?? []).includes(u));

beforeEach(() => {
  vi.resetAllMocks();
  (prisma.$transaction as any).mockResolvedValue([]);
  (prisma.mailboxes.findUnique as any).mockImplementation(async ({ where }: any) => ({ id: where.id, type: 'team' }));
});

describe('POST /api/threads/:id/move', () => {
  it('共有→共有: 両方のメンバーなら移せる。担当が移動先を見られなければ担当を外す', async () => {
    (prisma.threads.findUnique as any).mockResolvedValue(thread({ id: 'A', type: 'team', owner_user_id: null }, 'u9'));
    members({ A: ['u1', 'u9'], B: ['u1'] });
    expect((await move('B')).status).toBe(200);
    expect((prisma.threads.update as any).mock.calls[0][0].data).toEqual({ mailbox_id: 'B', assigned_user_id: null });
  });
  it('担当が移動先も見られるなら、担当はそのまま', async () => {
    (prisma.threads.findUnique as any).mockResolvedValue(thread({ id: 'A', type: 'team', owner_user_id: null }, 'u9'));
    members({ A: ['u1', 'u9'], B: ['u1', 'u9'] });
    await move('B');
    expect((prisma.threads.update as any).mock.calls[0][0].data).toEqual({ mailbox_id: 'B' });
  });
  it('移動先のメンバーでなければ403（入っていない共有メールボックスには移せない）', async () => {
    (prisma.threads.findUnique as any).mockResolvedValue(thread({ id: 'A', type: 'team', owner_user_id: null }));
    members({ A: ['u1'] });
    expect((await move('B')).status).toBe(403);
    expect(prisma.threads.update).not.toHaveBeenCalled();
  });
  it('移動元のメンバーでなければ403', async () => {
    (prisma.threads.findUnique as any).mockResolvedValue(thread({ id: 'A', type: 'team', owner_user_id: null }));
    members({ B: ['u1'] });
    expect((await move('B')).status).toBe(403);
  });
  it('同じメールボックスへは400', async () => {
    (prisma.threads.findUnique as any).mockResolvedValue(thread({ id: 'A', type: 'team', owner_user_id: null }));
    members({ A: ['u1'] });
    expect((await move('A')).status).toBe(400);
  });
  it('個人メールは持ち主だけ。個人メールへは移せない', async () => {
    (prisma.threads.findUnique as any).mockResolvedValue(thread({ id: 'P', type: 'personal', owner_user_id: 'other' }));
    members({ B: ['u1'] });
    expect((await move('B')).status).toBe(403);
    (prisma.threads.findUnique as any).mockResolvedValue(thread({ id: 'P', type: 'personal', owner_user_id: 'u1' }));
    (prisma.mailboxes.findUnique as any).mockResolvedValue({ id: 'Q', type: 'personal' });
    expect((await move('Q')).status).toBe(400);
  });
});
