import { prisma } from '@/lib/db';

export async function canViewMailbox(userId: string, mailboxId: string) {
  const [m, user] = await Promise.all([
    prisma.mailboxes.findUnique({ where: { id: mailboxId } }),
    prisma.users.findUnique({ where: { id: userId } })
  ]);
  if (!m || !user) return false;
  if (user.role === 'admin' || m.owner_user_id === userId) return true;

  const perm = await prisma.mailbox_permissions.findFirst({ where: { mailbox_id: mailboxId, user_id: userId, can_view: true } });
  return !!perm;
}

export async function canReplyMailbox(userId: string, mailboxId: string) {
  const [m, user] = await Promise.all([
    prisma.mailboxes.findUnique({ where: { id: mailboxId } }),
    prisma.users.findUnique({ where: { id: userId } })
  ]);
  if (!m || !user) return false;
  if (user.role === 'admin' || m.owner_user_id === userId) return true;
  const perm = await prisma.mailbox_permissions.findFirst({ where: { mailbox_id: mailboxId, user_id: userId, can_reply: true } });
  return !!perm;
}

export async function canAssignMailbox(userId: string, mailboxId: string) {
  const [m, user] = await Promise.all([
    prisma.mailboxes.findUnique({ where: { id: mailboxId } }),
    prisma.users.findUnique({ where: { id: userId } })
  ]);
  if (!m || !user) return false;
  if (user.role === 'admin' || m.owner_user_id === userId) return true;
  const perm = await prisma.mailbox_permissions.findFirst({ where: { mailbox_id: mailboxId, user_id: userId, can_assign: true } });
  return !!perm;
}
