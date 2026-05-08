import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// モック: データベース
vi.mock('@/lib/db', () => ({
  prisma: {
    users: { findUnique: vi.fn() },
    audit_logs: { create: vi.fn() },
  }
}));

// モック: パスワードハッシュ検証
vi.mock('@/lib/password', () => ({
  verifyPassword: vi.fn(),
}));

// モック: 認証・セッション
vi.mock('@/lib/auth', () => ({
  setSessionCookie: vi.fn(),
}));

// モック: 監査ログ
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

// モック: DoSアラート
vi.mock('@/lib/dos-alert', () => ({
  sendDosAlert: vi.fn(),
}));

import { POST } from '@/app/api/auth/login/route';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { setSessionCookie } from '@/lib/auth';

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNextRequest = (body: any) => {
    return {
      json: async () => body,
      headers: { get: () => null },
    } as unknown as NextRequest;
  };

  it('正しいメールアドレスとパスワードでログインできること', async () => {
    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      password_hash: 'hashed_password',
      role: 'user'
    };

    (prisma.users.findUnique as any).mockResolvedValue(mockUser);
    (verifyPassword as any).mockResolvedValue(true);

    const req = mockNextRequest({ email: 'test@example.com', password: 'correct_password' });
    const res = await POST(req);
    const data = await res.json();

    // 検証
    expect(prisma.users.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
    expect(verifyPassword).toHaveBeenCalledWith('correct_password', 'hashed_password');
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
    expect(setSessionCookie).toHaveBeenCalledWith(res, {
      userId: 'test-user-id',
      email: 'test@example.com',
      role: 'user'
    });
    
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('パスワードが間違っている場合、401を返すこと', async () => {
    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      password_hash: 'hashed_password',
      role: 'user'
    };

    (prisma.users.findUnique as any).mockResolvedValue(mockUser);
    (verifyPassword as any).mockResolvedValue(false); // パスワード不一致

    const req = mockNextRequest({ email: 'test@example.com', password: 'wrong_password' });
    const res = await POST(req);
    const data = await res.json();

    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(data.error).toBe('unauthorized');
  });

  it('存在しないユーザーの場合、401を返すこと', async () => {
    (prisma.users.findUnique as any).mockResolvedValue(null);

    const req = mockNextRequest({ email: 'nonexistent@example.com', password: 'password123' });
    const res = await POST(req);
    const data = await res.json();

    expect(verifyPassword).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(data.error).toBe('unauthorized');
  });

  it('リクエストのフォーマットが不正（emailなし）の場合、400または401で弾かれること', async () => {
    const req = mockNextRequest({ password: 'password123' }); // emailなし
    const res = await POST(req);

    // API側の実装により 400 (Zodエラー) または 401 の場合があります。ここではエラーを返すことを確認
    expect(res.ok).toBe(false);
  });
});
