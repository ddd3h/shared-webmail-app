import { prisma } from '@/lib/db';

// Mailbox access check: owner always has full access; admins have no implicit bypass
// (admins grant themselves access via Settings → Permissions)
export async function canViewMailbox(userId: string, mailboxId: string) {
  const m = await prisma.mailboxes.findFirst({
    where: {
      id: mailboxId,
      OR: [
        { type: 'personal', owner_user_id: userId },
        { permissions: { some: { user_id: userId, can_view: true } } }
      ]
    }
  });
  return !!m;
}

export async function canReplyMailbox(userId: string, mailboxId: string) {
  const m = await prisma.mailboxes.findFirst({ where: { id: mailboxId } });
  if (!m) return false;
  if (m.type === 'personal' && m.owner_user_id === userId) return true;
  const perm = await prisma.mailbox_permissions.findFirst({ where: { mailbox_id: mailboxId, user_id: userId, can_reply: true } });
  return !!perm;
}

export async function canAssignMailbox(userId: string, mailboxId: string) {
  const m = await prisma.mailboxes.findFirst({ where: { id: mailboxId } });
  if (!m) return false;
  if (m.type === 'personal' && m.owner_user_id === userId) return true;
  const perm = await prisma.mailbox_permissions.findFirst({ where: { mailbox_id: mailboxId, user_id: userId, can_assign: true } });
  return !!perm;
}
