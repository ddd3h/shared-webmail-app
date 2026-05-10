import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { buildThreadsWhere } from '@/lib/threads-filter';
import { logAudit } from '@/lib/audit';
import { deleteImapMessagesBulk } from '@/lib/mail/delete-utils';

export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  if (session.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id: approvalId } = await req.json();
  if (!approvalId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const request = await (prisma as any).pending_bulk_actions.findUnique({
    where: { id: approvalId },
    include: { user: true }
  });

  if (!request) return NextResponse.json({ error: 'not_found_or_processed' }, { status: 404 });
  if (request.expires_at < new Date()) {
    await (prisma as any).pending_bulk_actions.delete({ where: { id: approvalId } });
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  const filters = JSON.parse(request.filters_json);
  const where = buildThreadsWhere({
    session: { userId: request.user_id },
    status: filters.status,
    type: filters.type,
    q: filters.q,
    mine: filters.mine === '1',
    unread: filters.unread === '1',
    sent: filters.sent === '1',
    assigned: filters.assigned === '1'
  });

  const threads = await prisma.threads.findMany({
    where,
    include: {
      mailbox: { include: { credentials: true } },
      messages: { select: { imap_uid: true } }
    }
  });

  const threadIds = threads.map(t => t.id);

  if (threadIds.length > 0) {
    const mailboxMap = new Map<string, { cred: any, uids: number[] }>();
    for (const t of threads) {
      if (t.mailbox.credentials) {
        if (!mailboxMap.has(t.mailbox_id)) mailboxMap.set(t.mailbox_id, { cred: t.mailbox.credentials, uids: [] });
        const uids = t.messages.map(m => m.imap_uid).filter((u): u is number => u !== null);
        mailboxMap.get(t.mailbox_id)!.uids.push(...uids);
      }
    }

    const eventIds = (await prisma.notification_events.findMany({ where: { thread_id: { in: threadIds } }, select: { id: true } })).map(e => e.id);
    
    await prisma.$transaction([
      prisma.notification_deliveries.deleteMany({ where: { notification_event_id: { in: eventIds } } }),
      prisma.drafts.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.notification_events.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.mattermost_notifications.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.mattermost_forwards.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.mattermost_links.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.thread_visibility.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.thread_reads.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.thread_state_history.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.thread_assignments.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.message_sends.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.attachments.deleteMany({ where: { message: { thread_id: { in: threadIds } } } }),
      prisma.messages.deleteMany({ where: { thread_id: { in: threadIds } } }),
      prisma.threads.deleteMany({ where: { id: { in: threadIds } } }),
    ]);

    for (const data of mailboxMap.values()) {
      if (data.uids.length > 0) {
        deleteImapMessagesBulk(data.cred, data.uids).catch(() => {});
      }
    }
  }

  await logAudit({
    actorUserId: session.userId,
    actionType: 'bulk_delete_approved',
    targetType: 'threads',
    metadata: { count: threadIds.length, requesterId: request.user_id }
  });

  await (prisma as any).pending_bulk_actions.delete({ where: { id: approvalId } });

  return NextResponse.json({ ok: true, count: threadIds.length, requesterName: request.user.name });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  if (session.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const approvalId = url.searchParams.get('id');
  if (!approvalId) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const request = await (prisma as any).pending_bulk_actions.findUnique({
    where: { id: approvalId },
    include: { user: { select: { name: true } } }
  });

  if (!request) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Calculate affected mailboxes for context
  const filters = JSON.parse(request.filters_json);
  const where = buildThreadsWhere({
    session: { userId: request.user_id },
    status: filters.status,
    type: filters.type,
    q: filters.q,
    mine: filters.mine === '1',
    unread: filters.unread === '1',
    sent: filters.sent === '1',
    assigned: filters.assigned === '1'
  });

  const mailboxCounts = await prisma.threads.groupBy({
    by: ['mailbox_id'],
    where,
    _count: { _all: true }
  });

  const mailboxes = await prisma.mailboxes.findMany({
    where: { id: { in: mailboxCounts.map(m => m.mailbox_id) } },
    select: { id: true, display_name: true, email_address: true }
  });

  const affectedMailboxes = mailboxCounts.map(mc => {
    const mb = mailboxes.find(m => m.id === mc.mailbox_id);
    return {
      name: mb?.display_name || '不明なメールボックス',
      email: mb?.email_address,
      count: mc._count._all
    };
  });

  return NextResponse.json({
    id: request.id,
    count: request.count,
    expires_at: request.expires_at,
    user: request.user,
    affectedMailboxes
  });
}
