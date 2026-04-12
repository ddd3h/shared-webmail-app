import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => {
  return {
    prisma: {
      mailboxes: { findUnique: vi.fn() },
      users: { findUnique: vi.fn() },
      mailbox_permissions: { findFirst: vi.fn() },
      team_members: { findFirst: vi.fn() }
    }
  };
});

import { prisma } from '@/lib/db';
import { canViewMailbox, canReplyMailbox, canAssignMailbox } from '@/lib/rbac';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('RBAC', () => {
  it('admin overrides', async () => {
    (prisma.mailboxes.findUnique as any).mockResolvedValue({ id: 'm1', type: 'personal', owner_user_id: 'u1' });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'admin', role: 'admin' });
    expect(await canViewMailbox('admin', 'm1')).toBe(true);
    expect(await canReplyMailbox('admin', 'm1')).toBe(true);
    expect(await canAssignMailbox('admin', 'm1')).toBe(true);
  });

  it('user with permissions can view mailbox', async () => {
    (prisma.mailboxes.findUnique as any).mockResolvedValue({ id: 'm2', type: 'team', owner_user_id: null });
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'u2', role: 'user' });
    (prisma.mailbox_permissions.findFirst as any).mockResolvedValue({ id: 'p1', can_view: true });
    expect(await canViewMailbox('u2', 'm2')).toBe(true);
  });
});

