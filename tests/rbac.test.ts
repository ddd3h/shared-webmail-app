import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => {
  return {
    prisma: {
      mailboxes: { findFirst: vi.fn() },
      mailbox_permissions: { findFirst: vi.fn() },
    }
  };
});

import { prisma } from '@/lib/db';
import { canViewMailbox, canReplyMailbox, canAssignMailbox } from '@/lib/rbac';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('RBAC', () => {
  it('個人メールボックスのオーナーはビュー・返信・担当の権限を持つ', async () => {
    const ownedBox = { id: 'm1', type: 'personal', owner_user_id: 'u1' };
    (prisma.mailboxes.findFirst as any).mockResolvedValue(ownedBox);
    expect(await canViewMailbox('u1', 'm1')).toBe(true);

    (prisma.mailboxes.findFirst as any).mockResolvedValue(ownedBox);
    expect(await canReplyMailbox('u1', 'm1')).toBe(true);

    (prisma.mailboxes.findFirst as any).mockResolvedValue(ownedBox);
    expect(await canAssignMailbox('u1', 'm1')).toBe(true);
  });

  it('user with permissions can view mailbox', async () => {
    // findFirst with OR clause matches via permissions — returns the mailbox
    (prisma.mailboxes.findFirst as any).mockResolvedValue({ id: 'm2', type: 'team', owner_user_id: null });
    expect(await canViewMailbox('u2', 'm2')).toBe(true);
  });
});

