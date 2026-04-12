import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// 1. Mocking internal and external libs
vi.mock('@/lib/db', () => ({
  prisma: {
    messages: { findUnique: vi.fn(), create: vi.fn() },
    attachments: { create: vi.fn() },
    message_sends: { create: vi.fn() },
    threads: { update: vi.fn() },
  }
}));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  requireAuth: (s: any) => { if (!s) throw { status: 401 }; },
}));

vi.mock('@/lib/rbac', () => ({
  canReplyMailbox: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@/lib/mail/send-job', () => ({
  sendMailForMessage: vi.fn().mockResolvedValue({}),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  }
}));

import { POST } from '@/app/api/messages/[id]/reply/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canReplyMailbox } from '@/lib/rbac';
import { sendMailForMessage } from '@/lib/mail/send-job';

describe('POST /api/messages/[id]/reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNextRequest = (body: any) => {
    return {
      headers: new Map([['content-type', 'application/json']]),
      json: async () => body,
    } as unknown as NextRequest;
  };

  const mockOrigMessage = {
    id: 'orig-1',
    thread_id: 't-1',
    mailbox_id: 'mb-1',
    subject: 'Original Subject',
    external_message_id: '<ext-1@host>',
    references_raw: '<ref-old@host>',
    direction: 'incoming',
    from_email: 'customer@example.com',
    mailbox: {
      display_name: 'Support',
      email_address: 'support@example.com'
    }
  };

  it('返信権限がない場合に 403 を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });
    (prisma.messages.findUnique as any).mockResolvedValue(mockOrigMessage);
    (canReplyMailbox as any).mockResolvedValue(false);

    const req = mockNextRequest({ text: 'Hello' });
    const params = Promise.resolve({ id: 'orig-1' });

    const res = await POST(req, { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe('forbidden');
  });

  it('正常な返信データを受け取ると、メッセージとジョブを作成する', async () => {
    (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });
    (prisma.messages.findUnique as any).mockResolvedValue(mockOrigMessage);
    (canReplyMailbox as any).mockResolvedValue(true);
    (prisma.messages.create as any).mockResolvedValue({ id: 'new-msg-1', thread_id: 't-1', mailbox_id: 'mb-1' });

    const req = mockNextRequest({
      text: 'Thank you for your inquiry.',
      to: ['customer@example.com']
    });
    const params = Promise.resolve({ id: 'orig-1' });

    const res = await POST(req, { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    // メッセージが作成されたか
    expect(prisma.messages.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        direction: 'outgoing',
        subject: 'Re: Original Subject',
        text_body: 'Thank you for your inquiry.',
        in_reply_to: '<ext-1@host>'
      })
    }));

    // 送信ジョブが作成されたか
    expect(prisma.message_sends.create).toHaveBeenCalled();

    // スレッドが更新されたか
    expect(prisma.threads.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't-1' }
    }));

    // 送信処理が呼び出されたか
    expect(sendMailForMessage).toHaveBeenCalledWith('new-msg-1');
  });

  it('宛先が不明な場合に 400 (no_recipient) を返す', async () => {
    (getSession as any).mockResolvedValue({ userId: 'u1', role: 'user' });
    // direction=outgoing かつ from_email なしなどの特殊なケース
    (prisma.messages.findUnique as any).mockResolvedValue({
      ...mockOrigMessage,
      direction: 'outgoing',
      from_email: null,
      to_raw: null
    });
    (canReplyMailbox as any).mockResolvedValue(true);

    const req = mockNextRequest({ text: 'Hello' });
    const params = Promise.resolve({ id: 'orig-1' });

    const res = await POST(req, { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('no_recipient');
  });
});
