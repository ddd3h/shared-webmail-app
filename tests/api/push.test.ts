import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock DB
vi.mock('@/lib/db', () => ({
  prisma: {
    push_subscriptions: { upsert: vi.fn(), updateMany: vi.fn() },
  }
}));

// Mock Auth
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  requireAuth: (s: any) => { if (!s) throw { status: 401 }; },
}));

import { POST, DELETE } from '@/app/api/push/subscribe/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

describe('Push Subscription API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNextRequest = (body: any) => {
    return {
      json: async () => body,
    } as unknown as NextRequest;
  };

  const validSub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/foo',
    keys: {
      p256dh: 'p256dh-key',
      auth: 'auth-secret'
    },
    platform: 'chrome'
  };

  describe('POST /api/push/subscribe', () => {
    it('正常な購読情報を送ると、upsert が呼ばれる', async () => {
      (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });

      const req = mockNextRequest(validSub);
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(prisma.push_subscriptions.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { endpoint: validSub.endpoint },
        create: expect.objectContaining({ user_id: 'u1', auth: 'auth-secret' })
      }));
    });

    it('不正なURL形式の endpoint の場合、バリデーションエラーを投げる', async () => {
      (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });

      const req = mockNextRequest({ ...validSub, endpoint: 'not-a-url' });
      await expect(POST(req)).rejects.toThrow(); // ZodError
    });
  });

  describe('DELETE /api/push/subscribe', () => {
    it('endpoint を指定して削除（論理削除）できる', async () => {
      (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });

      const req = mockNextRequest({ endpoint: 'https://example.com/sub1' });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(prisma.push_subscriptions.updateMany).toHaveBeenCalledWith({
        where: { endpoint: 'https://example.com/sub1', user_id: 'u1' },
        data: { is_active: false }
      });
    });
  });
});
