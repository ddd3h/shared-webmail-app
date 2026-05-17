import { prisma } from './db';

export async function resolveChatThread(
  threadId: string,
  userId: string,
): Promise<{ threadId: string; mailboxId: string } | null> {
  const thread = await prisma.threads.findFirst({
    where: {
      id: threadId,
      mailbox: {
        type: 'team',
        OR: [
          { permissions: { some: { user_id: userId, can_view: true } } },
        ],
      },
    },
    select: { id: true, mailbox_id: true },
  });
  if (!thread) return null;
  return { threadId: thread.id, mailboxId: thread.mailbox_id };
}
