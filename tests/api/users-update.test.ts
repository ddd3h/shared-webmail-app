import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mock internal libraries
vi.mock('@/lib/db', () => ({
  prisma: {
    users: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    audit_logs: {
      create: vi.fn(),
    }
  }
}));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  requireAuth: (s: any) => { if (!s) throw { status: 401 }; },
}));

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p) => Promise.resolve(`hashed_${p}`)),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

// 2. Import under test (after mocks)
import { PUT } from '@/app/api/users/[id]/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { NextRequest } from 'next/server';

describe('PUT /api/users/[id] (API logic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNextRequest = (body: any) => {
    return {
      json: async () => body,
    } as unknown as NextRequest;
  };

  it('管理者以外が更新しようとすると 403 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'user-id', role: 'user' });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'user-id', role: 'user' });

    const req = mockNextRequest({ name: 'New Name' });
    const params = Promise.resolve({ id: 'target-id' });

    const res = await PUT(req, { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe('forbidden');
  });

  it('管理者が正常なデータを送信するとユーザーが更新される (Regression: mattermost_user_id)', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.id === 'admin-id') return Promise.resolve({ id: 'admin-id', role: 'admin' });
        return Promise.resolve(null); // for email check
    });
    (prisma.users.update as any).mockResolvedValue({ id: 'target-id' });

    const req = mockNextRequest({ 
      name: 'Updated Name',
      mattermost_user_id: 'mm-id-123' 
    });
    const params = Promise.resolve({ id: 'target-id' });

    const res = await PUT(req, { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    
    // Check if prisma.users.update was called with correct data
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 'target-id' },
      data: {
        name: 'Updated Name',
        mattermost_user_id: 'mm-id-123'
      }
    });
  });

  it('mattermost_user_id に null を送ると null で更新される', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'admin-id', role: 'admin' });
    (prisma.users.update as any).mockResolvedValue({ id: 'target-id' });

    const req = mockNextRequest({ mattermost_user_id: null });
    const params = Promise.resolve({ id: 'target-id' });

    await PUT(req, { params });

    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 'target-id' },
      data: { mattermost_user_id: null }
    });
  });

  it('バリデーションエラー (email不正) の場合に 400 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'admin-id', role: 'admin' });

    const req = mockNextRequest({ email: 'invalid-email' });
    const params = Promise.resolve({ id: 'target-id' });

    const res = await PUT(req, { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_request');
  });

  it('既存の他ユーザーのメールアドレスと重複する場合に 400 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.id === 'admin-id') return Promise.resolve({ id: 'admin-id', role: 'admin' });
        if (where.email === 'duplicate@example.com') return Promise.resolve({ id: 'other-id', email: 'duplicate@example.com' });
        return Promise.resolve(null);
    });

    const req = mockNextRequest({ email: 'duplicate@example.com' });
    const params = Promise.resolve({ id: 'target-id' });

    const res = await PUT(req, { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('email_already_exists');
  });
});
