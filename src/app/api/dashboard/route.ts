import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const { userId } = session;

  const [myThreads, teamInProgress, totalThreads, user, mailboxStorage, recentTeamThreads] = await Promise.all([
    // 1. My assigned (personal + team assigned)
    prisma.threads.count({
      where: { assigned_user_id: userId, status: { not: 'done' } }
    }),
    // 2. Team in progress (where user has view permission)
    prisma.threads.count({
      where: { 
        status: 'in_progress', 
        mailbox: { type: 'team', permissions: { some: { user_id: userId, can_view: true } } } 
      }
    }),
    // 3. Total viewable threads
    prisma.threads.count({
      where: {
        mailbox: {
          OR: [
            { type: 'personal', owner_user_id: userId },
            { type: 'team', permissions: { some: { user_id: userId, can_view: true } } }
          ]
        }
      }
    }),
    // 4. User info
    prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, last_login_at: true }
    }),
    // 5. Personal storage usage
    prisma.mailboxes.findMany({
      where: { owner_user_id: userId, type: 'personal' },
      select: { id: true, display_name: true, email_address: true, cached_size_bytes: true, size_cached_at: true }
    }),
    // 6. Recent team threads
    prisma.threads.findMany({
      where: {
        mailbox: { type: 'team', permissions: { some: { user_id: userId, can_view: true } } }
      },
      take: 5,
      orderBy: { last_message_at: 'desc' },
      select: {
        id: true,
        subject: true,
        status: true,
        last_message_at: true,
        unread_count: true,
        mailbox: { select: { display_name: true } },
        assigned_user: { select: { name: true } }
      }
    })
  ]);

  const STORAGE_LIMIT = 5 * 1024 * 1024 * 1024; // 5GB limit

  const formattedStorage = mailboxStorage.map(mb => {
    const used = Number(mb.cached_size_bytes || 0);
    return {
      id: mb.id,
      display_name: mb.display_name,
      email_address: mb.email_address,
      used_bytes: used,
      max_bytes: STORAGE_LIMIT,
      percent: Math.min(100, Math.round((used / STORAGE_LIMIT) * 100)),
      cached_at: mb.size_cached_at
    };
  });

  return NextResponse.json({
    user,
    stats: {
      myAssigned: myThreads,
      inProgress: teamInProgress,
      total: totalThreads
    },
    recentTeamThreads,
    mailboxStorage: formattedStorage
  });
}
