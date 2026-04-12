import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    users: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    threads: { updateMany: vi.fn() },
    mailboxes: { updateMany: vi.fn() },
    mailbox_permissions: { deleteMany: vi.fn() },
    push_subscriptions: { deleteMany: vi.fn() },
    thread_visibility: { deleteMany: vi.fn() },
    drafts: { deleteMany: vi.fn() },
    $transaction: vi.fn((operations) => Promise.all(operations)),
  }
}));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  requireAuth: (s: any) => { if (!s) throw { status: 401 }; },
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

import { DELETE } from '@/app/api/users/[id]/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

describe('DELETE /api/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('管理者以外が削除しようとすると 403 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'user-id', role: 'user' });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'user-id', role: 'user' });

    const params = Promise.resolve({ id: 'target-id' });
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(403);
  });

  it('自分自身を削除しようとすると 400 (cannot_delete_self) を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'admin-id', role: 'admin' });

    const params = Promise.resolve({ id: 'admin-id' });
    const res = await DELETE({} as NextRequest, { params });
    const data = await res.json();
    
    expect(res.status).toBe(400);
    expect(data.error).toBe('cannot_delete_self');
    expect(prisma.users.delete).not.toHaveBeenCalled();
  });

  it('存在しないユーザーを削除しようとすると 404 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.id === 'admin-id') return Promise.resolve({ id: 'admin-id', role: 'admin' });
        if (where.id === 'nonexistent-id') return Promise.resolve(null);
        return Promise.resolve(null);
    });

    const params = Promise.resolve({ id: 'nonexistent-id' });
    const res = await DELETE({} as NextRequest, { params });
    
    expect(res.status).toBe(404);
  });

  it('管理者が他のユーザーを正常に削除できる', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.id === 'admin-id') return Promise.resolve({ id: 'admin-id', role: 'admin' });
        if (where.id === 'target-id') return Promise.resolve({ id: 'target-id', email: 'target@example.com' });
        return Promise.resolve(null);
    });

    const params = Promise.resolve({ id: 'target-id' });
    const res = await DELETE({} as NextRequest, { params });
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    
    // トランザクション経由で削除が呼ばれたことを確認
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.users.delete).toHaveBeenCalledWith({ where: { id: 'target-id' } });
  });
});
