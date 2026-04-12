import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// モック
vi.mock('@/lib/db', () => ({
  prisma: {
    mailboxes: { findMany: vi.fn(), create: vi.fn() },
  }
}));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  requireAuth: (s: any) => { if (!s) throw { status: 401 }; },
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn((p) => Promise.resolve(`enc_${p}`)),
}));

import { POST, GET } from '@/app/api/mailboxes/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';

describe('POST /api/mailboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNextRequest = (body: any) => {
    return {
      json: async () => body,
      url: 'http://localhost/api/mailboxes'
    } as unknown as NextRequest;
  };

  const validPayload = {
    type: 'personal',
    display_name: 'My Mail',
    email_address: 'me@example.com',
    username: 'me@example.com',
    password: 'secret-password',
    imap: { host: 'imap.example.com', port: 993, secure: true },
    smtp: { host: 'smtp.example.com', port: 465, secure: true }
  };

  it('管理者以外がチームメールボックスを作成しようとすると 403 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });

    const req = mockNextRequest({ ...validPayload, type: 'team' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe('forbidden');
  });

  it('個人メールボックス作成時、作成者が自動的にオーナーになる', async () => {
    (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });
    (prisma.mailboxes.create as any).mockResolvedValue({ id: 'mb-1' });

    const req = mockNextRequest(validPayload);
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(encrypt).toHaveBeenCalledWith('secret-password');
    expect(prisma.mailboxes.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'personal',
        owner_user_id: 'u1',
        credentials: {
          create: expect.objectContaining({
            username: 'me@example.com',
            encrypted_password: 'enc_secret-password'
          })
        }
      })
    }));
  });

  it('バリデーションエラーの場合にエラーを投げる', async () => {
    (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });

    const req = mockNextRequest({ ...validPayload, email_address: 'invalid-email' });
    await expect(POST(req)).rejects.toThrow();
  });
});

describe('GET /api/mailboxes', () => {
  it('一般ユーザーは自分が権限を持つメールボックスのみ取得できる', async () => {
    (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });
    (prisma.mailboxes.findMany as any).mockResolvedValue([]);

    const req = { url: 'http://localhost/api/mailboxes' } as NextRequest;
    await GET(req);

    expect(prisma.mailboxes.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { owner_user_id: 'u1' },
          { permissions: { some: { user_id: 'u1', can_view: true } } }
        ]
      }
    }));
  });

  it('管理者はデフォルトですべてのメールボックスを取得できる', async () => {
    (getSession as any).mockResolvedValue({ userId: 'admin1', role: 'admin' });
    (prisma.mailboxes.findMany as any).mockResolvedValue([]);

    const req = { url: 'http://localhost/api/mailboxes' } as NextRequest;
    await GET(req);

    expect(prisma.mailboxes.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {}
    }));
  });
});
