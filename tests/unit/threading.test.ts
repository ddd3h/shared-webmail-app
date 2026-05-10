import { describe, it, expect, vi, beforeEach } from 'vitest';

// モック: データベース
vi.mock('@/lib/db', () => ({
  prisma: {
    threads: { 
      findFirst: vi.fn(), 
      create: vi.fn(), 
      update: vi.fn() 
    },
  }
}));

import { findOrCreateThread, ThreadMatchInput } from '@/lib/threading';
import { prisma } from '@/lib/db';

describe('Threading Logic (findOrCreateThread)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseMsg: ThreadMatchInput = {
    externalId: 'msg-id-123',
    inReplyTo: null,
    references: [],
    subject: 'Hello World',
    fromName: 'Test Sender',
    fromEmail: 'sender@example.com',
    to: ['receiver@example.com'],
    cc: [],
    text: 'Body text',
    html: '<p>Body text</p>',
    date: new Date(),
    hasAttachments: false,
  };

  it('30日以内の同じ正規化件名があれば既存のスレッドIDを返し、タイムスタンプを更新する', async () => {
    // 既存スレッドがある想定
    (prisma.threads.findFirst as any).mockResolvedValue({ id: 't-existing' });
    (prisma.threads.update as any).mockResolvedValue({ id: 't-existing' });

    const pm: ThreadMatchInput = {
      ...baseMsg,
      subject: 'Re: Hello World', // 件名は正規化される
    };

    const threadId = await findOrCreateThread('mb1', pm);

    expect(threadId).toBe('t-existing');
    
    // findFirst の呼び出し確認 (正規化件名のチェック)
    expect(prisma.threads.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        mailbox_id: 'mb1',
        normalized_subject: 'hello world',
      })
    }));

    // update の呼び出し確認
    expect(prisma.threads.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't-existing' },
      data: expect.objectContaining({
        last_message_at: pm.date
      })
    }));
  });

  it('該当するスレッドがない場合、新しいスレッドを作成する', async () => {
    (prisma.threads.findFirst as any).mockResolvedValue(null);
    (prisma.threads.create as any).mockResolvedValue({ id: 'new-t' });

    const threadId = await findOrCreateThread('mb2', baseMsg);

    expect(threadId).toBe('new-t');
    expect(prisma.threads.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mailbox_id: 'mb2',
        subject: baseMsg.subject,
        normalized_subject: 'hello world',
        status: 'open',
        unread_count: 1
      })
    }));
  });
});
