import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { notification_events: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })) } },
}));

import { prisma } from '@/lib/db';
import { listNotifications, unreadNotificationCount, markNotificationsRead } from '@/lib/notifications';

const mailOut = { event_type: { notIn: ['new_message', 'thread_updated'] } };
beforeEach(() => vi.clearAllMocks());

describe('通知のベル: メールの新着は入れない', () => {
  it('一覧にも、未読の数にも、「すべて既読」にも、メールの通知を含めない', async () => {
    await listNotifications('u1');
    expect((prisma.notification_events.findMany as any).mock.calls[0][0].where).toMatchObject(mailOut);
    await unreadNotificationCount('u1');
    expect((prisma.notification_events.count as any).mock.calls[0][0].where).toMatchObject(mailOut);
    await markNotificationsRead('u1', { all: true });
    expect((prisma.notification_events.updateMany as any).mock.calls[0][0].where).toMatchObject(mailOut);
  });
});
