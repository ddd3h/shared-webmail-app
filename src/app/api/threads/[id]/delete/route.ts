import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';

// DELETE (via POST) /api/threads/[id]/delete
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const thread = await prisma.threads.findUnique({
    where: { id },
    include: {
      mailbox: { include: { credentials: true } },
      messages: { select: { imap_uid: true } }
    }
  });
  if (!thread) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Permission check: must have view access to the mailbox
  const canAccess = await prisma.mailboxes.findFirst({
    where: {
      id: thread.mailbox_id,
      OR: [
        { type: 'personal', owner_user_id: session.userId },
        { permissions: { some: { user_id: session.userId, can_view: true } } }
      ]
    }
  });
  if (!canAccess) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Collect IMAP UIDs before deletion
  const imapUids = thread.messages
    .map(m => m.imap_uid)
    .filter((u): u is number => u !== null);

  await logAudit({
    actorUserId: session.userId,
    actionType: 'delete_thread',
    targetType: 'threads',
    targetId: id,
    metadata: { subject: thread.subject }
  });

  // Delete in dependency order
  const eventIds = (await prisma.notification_events.findMany({ where: { thread_id: id }, select: { id: true } })).map(e => e.id);

  await prisma.$transaction([
    prisma.notification_deliveries.deleteMany({ where: { notification_event_id: { in: eventIds } } }),
    prisma.drafts.deleteMany({ where: { thread_id: id } }),
    prisma.notification_events.deleteMany({ where: { thread_id: id } }),
    prisma.mattermost_notifications.deleteMany({ where: { thread_id: id } }),
    prisma.mattermost_forwards.deleteMany({ where: { thread_id: id } }),
    prisma.mattermost_links.deleteMany({ where: { thread_id: id } }),
    prisma.thread_visibility.deleteMany({ where: { thread_id: id } }),
    prisma.thread_reads.deleteMany({ where: { thread_id: id } }),
    prisma.thread_state_history.deleteMany({ where: { thread_id: id } }),
    prisma.thread_assignments.deleteMany({ where: { thread_id: id } }),
    prisma.message_sends.deleteMany({ where: { thread_id: id } }),
    prisma.attachments.deleteMany({ where: { message: { thread_id: id } } }),
    prisma.messages.deleteMany({ where: { thread_id: id } }),
    prisma.threads.delete({ where: { id } }),
  ]);

  // Fire-and-forget: delete from IMAP server
  if (thread.mailbox.credentials && imapUids.length > 0) {
    deleteImapMessages(thread.mailbox.credentials, imapUids).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

async function deleteImapMessages(
  cred: { imap_host: string; imap_port: number; imap_secure: boolean; username: string; encrypted_password: string },
  uids: number[]
) {
  const { decrypt } = await import('@/lib/crypto');
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: cred.imap_host,
    port: cred.imap_port,
    secure: cred.imap_secure,
    auth: { user: cred.username, pass: await decrypt(cred.encrypted_password) },
    logger: false,
    tls: { rejectUnauthorized: false }
  } as any);

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uidRange = uids.join(',');
    await client.messageFlagsAdd(uidRange as any, ['\\Deleted'], { uid: true } as any);
    await (client as any).messageDelete(uidRange, { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}
