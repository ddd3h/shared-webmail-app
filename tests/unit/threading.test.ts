import { describe, it, expect, vi, beforeEach } from 'vitest';

// モック: データベース
vi.mock('@/lib/db', () => ({
  prisma: {
    messages: { findFirst: vi.fn() },
    threads: { findFirst: vi.fn(), create: vi.fn() },
  }
}));

import { findOrCreateThread, ParsedMessage } from '@/lib/threading';
import { prisma } from '@/lib/db';

describe('Threading Logic (findOrCreateThread)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseMsg: ParsedMessage = {
    externalId: 'msg-id-123',
    subject: 'Hello World',
    fromEmail: 'sender@example.com',
    to: ['receiver@example.com'],
    date: new Date(),
    hasAttachments: false,
  };

  it('In-Reply-To が一致する場合、既存のスレッドIDを返す', async () => {
    // 既存メッセージがある想定
    (prisma.messages.findFirst as any).mockResolvedValue({ id: 'm1', thread_id: 't1' });

    const pm: ParsedMessage = {
      ...baseMsg,
      inReplyTo: '<original-msg-id@host>',
    };

    const threadId = await findOrCreateThread('mb1', pm);

    expect(threadId).toBe('t1');
    expect(prisma.messages.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        mailbox_id: 'mb1',
        external_message_id: { in: ['original-msg-id@host', '<original-msg-id@host>'] }
      }
    }));
  });

  it('References のいずれかが一致する場合、既存のスレッドIDを返す', async () => {
    (prisma.messages.findFirst as any).mockImplementation(({ where }: any) => {
      // 1回目 (in-reply-to): null, 2回目 (references): ヒット
      if (where.external_message_id.in.includes('ref1@host')) {
        return Promise.resolve({ id: 'm2', thread_id: 't2' });
      }
      return Promise.resolve(null);
    });

    const pm: ParsedMessage = {
      ...baseMsg,
      references: ['<ref1@host>', '<ref2@host>'],
    };

    const threadId = await findOrCreateThread('mb2', pm);

    expect(threadId).toBe('t2');
  });

  it('IDが一致しなくても、30日以内の同じ正規化件名があれば紐付ける', async () => {
    (prisma.messages.findFirst as any).mockResolvedValue(null);
    (prisma.threads.findFirst as any).mockResolvedValue({ id: 't3', subject: 'Hello World' });

    const pm: ParsedMessage = {
      ...baseMsg,
      subject: 'Re: Hello World', // 件名は正規化される
    };

    const threadId = await findOrCreateThread('mb3', pm);

    expect(threadId).toBe('t3');
    expect(prisma.threads.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        normalized_subject: 'hello world',
      })
    }));
  });

  it('どれにも該当しない場合、新しいスレッドを作成する', async () => {
    (prisma.messages.findFirst as any).mockResolvedValue(null);
    (prisma.threads.findFirst as any).mockResolvedValue(null);
    (prisma.threads.create as any).mockResolvedValue({ id: 'new-t' });

    const threadId = await findOrCreateThread('mb4', baseMsg);

    expect(threadId).toBe('new-t');
    expect(prisma.threads.create).toHaveBeenCalled();
  });
});
