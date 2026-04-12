import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    users: {
      findUnique: vi.fn(),
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

import { POST } from '@/app/api/users/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

describe('POST /api/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNextRequest = (body: any) => {
    return {
      json: async () => body,
    } as unknown as NextRequest;
  };

  it('管理者以外が作成しようとすると 403 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'user-id', role: 'user' });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'user-id', role: 'user' });

    const req = mockNextRequest({ name: 'New User', email: 'new@example.com', password: 'password123' });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('重複したメールアドレスで作成しようとすると 400 (email_already_exists) を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.id === 'admin-id') return Promise.resolve({ id: 'admin-id', role: 'admin' });
        if (where.email === 'duplicate@example.com') return Promise.resolve({ id: 'existing-id' });
        return Promise.resolve(null);
    });

    const req = mockNextRequest({ name: 'Duplicate User', email: 'duplicate@example.com', password: 'password123' });
    const res = await POST(req);
    const data = await res.json();
    
    expect(res.status).toBe(400);
    expect(data.error).toBe('email_already_exists');
    expect(prisma.users.create).not.toHaveBeenCalled();
  });

  it('管理者が正常なデータを送信するとユーザーが作成される', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockImplementation(({ where }: any) => {
        if (where.id === 'admin-id') return Promise.resolve({ id: 'admin-id', role: 'admin' });
        return Promise.resolve(null);
    });
    (prisma.users.create as any).mockResolvedValue({ id: 'new-user-id' });

    const req = mockNextRequest({
      name: 'New User',
      email: 'new@example.com',
      password: 'password123',
      role: 'admin',
      mattermost_user_id: 'mm123'
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.id).toBe('new-user-id');
    expect(prisma.users.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'New User',
        email: 'new@example.com',
        role: 'admin',
        mattermost_user_id: 'mm123',
        password_hash: 'hashed_password123'
      })
    }));
  });

  it('バリデーションエラーの場合に 400 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin-id', role: 'admin' });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'admin-id', role: 'admin' });

    const req = mockNextRequest({ name: '', email: 'invalid', password: 'short' }); // Invalid data
    const res = await POST(req);
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('bad_request');
  });
});
