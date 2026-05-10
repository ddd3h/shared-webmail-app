import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';

// POST /api/threads/[id]/read
// Marks the thread as read for the current user.
// For team mailboxes: if ALL users with view permission have read it,
// also marks the IMAP messages as \Seen.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const thread = await prisma.threads.findUnique({
    where: { id },
    include: {
      mailbox: { include: { credentials: true, permissions: true } },
      messages: { where: { direction: 'incoming', imap_uid: { not: null } }, select: { imap_uid: true } }
    }
  });
  if (!thread) return NextResponse.json({ ok: true });

  const canAccess = await prisma.mailboxes.findFirst({
    where: {
      id: thread.mailbox_id,
      OR: [
        { type: 'personal', owner_user_id: session!.userId },
        { permissions: { some: { user_id: session!.userId, can_view: true } } }
      ]
    }
  });
  if (!canAccess) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Upsert per-user read record
  await prisma.thread_reads.upsert({
    where: { thread_id_user_id: { thread_id: id, user_id: session!.userId } },
    create: { thread_id: id, user_id: session!.userId },
    update: { last_read_at: new Date() }
  });

  // For personal mailboxes: clear unread_count and immediately mark IMAP as \Seen
  if (thread.mailbox.type !== 'team') {
    await prisma.threads.update({ where: { id }, data: { unread_count: 0 } });
    if (thread.mailbox.credentials) {
      const uids = thread.messages.map(m => m.imap_uid).filter((u): u is number => u !== null);
      if (uids.length > 0) {
        markImapSeen(thread.mailbox.credentials, uids).catch(() => {});
      }
    }
  }

  // For team mailboxes: check if everyone has read
  if (thread.mailbox.type === 'team' && thread.mailbox.credentials) {
    const allPermittedUserIds = thread.mailbox.permissions
      .filter(p => p.can_view)
      .map(p => p.user_id);

    if (allPermittedUserIds.length > 0) {
      const readCount = await prisma.thread_reads.count({
        where: { thread_id: id, user_id: { in: allPermittedUserIds } }
      });

      // All permitted users have now read this thread → mark IMAP as \Seen
      if (readCount >= allPermittedUserIds.length) {
        const uids = thread.messages.map(m => m.imap_uid).filter((u): u is number => u !== null);
        if (uids.length > 0) {
          markImapSeen(thread.mailbox.credentials, uids).catch(() => {});
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

async function markImapSeen(
  cred: { imap_host: string; imap_port: number; imap_secure: boolean; username: string; encrypted_password: string },
  uids: number[]
) {
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
    await client.messageFlagsAdd(uidRange as any, ['\\Seen'], { uid: true } as any);
  } finally {
    lock.release();
    await client.logout();
  }
}
