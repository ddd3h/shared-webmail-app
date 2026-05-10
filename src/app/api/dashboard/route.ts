import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

const MAX_MAILBOX_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

function mailboxAccessFilter(userId: string) {
  return {
    OR: [
      { type: 'personal' as const, owner_user_id: userId },
      { permissions: { some: { user_id: userId, can_view: true } } }
    ]
  };
}

export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const userId = session!.userId;
  const mbFilter = mailboxAccessFilter(userId);

  const [myAssigned, inProgressCount, recentTeamThreads, user, myMailboxes] = await Promise.all([
    prisma.threads.count({
      where: { assigned_user_id: userId, is_archived: false, status: { not: 'done' } }
    }),
    prisma.threads.count({
      where: { is_archived: false, status: 'in_progress', mailbox: mbFilter }
    }),
    prisma.threads.findMany({
      where: { is_archived: false, mailbox: { type: 'team', ...mbFilter } },
      orderBy: { last_message_at: 'desc' },
      take: 10,
      select: {
        id: true, subject: true, status: true, last_message_at: true,
        unread_count: true,
        mailbox: { select: { display_name: true } },
        assigned_user: { select: { name: true } }
      }
    }),
    prisma.users.findUnique({
      where: { id: userId },
      select: { name: true, email: true, role: true, last_login_at: true }
    }),
    // Fetch personal mailboxes with cached size data
    prisma.mailboxes.findMany({
      where: { type: 'personal', owner_user_id: userId },
      select: { id: true, display_name: true, email_address: true, cached_size_bytes: true, size_cached_at: true }
    })
  ]);

  // Build storage entries from cache (calculate only if no cache yet)
  const mailboxStorage = await Promise.all(myMailboxes.map(async mb => {
    let usedBytes: number;
    let cachedAt: string | null = mb.size_cached_at?.toISOString() ?? null;

    if (mb.cached_size_bytes !== null && mb.cached_size_bytes !== undefined) {
      // Use cached value
      usedBytes = Number(mb.cached_size_bytes);
    } else {
      // First access: calculate and cache
      const rows = await prisma.$queryRaw<[{ total: bigint }]>`
        SELECT (
          COALESCE(SUM(LENGTH(m.text_body)), 0) +
          COALESCE(SUM(LENGTH(m.html_body)), 0) +
          COALESCE((SELECT SUM(a.size) FROM attachments a JOIN messages m2 ON a.message_id = m2.id WHERE m2.mailbox_id = ${mb.id}), 0)
        )::bigint AS total
        FROM messages m WHERE m.mailbox_id = ${mb.id}
      `;
      usedBytes = Number(rows[0].total);
      const now = new Date();
      cachedAt = now.toISOString();
      // Fire and forget — don't block the response
      prisma.mailboxes.update({
        where: { id: mb.id },
        data: { cached_size_bytes: BigInt(usedBytes), size_cached_at: now }
      }).catch(() => {});
    }

    return {
      id: mb.id,
      display_name: mb.display_name,
      email_address: mb.email_address,
      used_bytes: usedBytes,
      max_bytes: MAX_MAILBOX_BYTES,
      percent: Math.min(100, Math.round((usedBytes / MAX_MAILBOX_BYTES) * 1000) / 10),
      cached_at: cachedAt
    };
  }));

  return NextResponse.json({
    user,
    stats: { myAssigned, inProgress: inProgressCount },
    recentTeamThreads,
    mailboxStorage
  });
}
