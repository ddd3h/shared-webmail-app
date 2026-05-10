import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { buildThreadsWhere } from '@/lib/threads-filter';
import { sendBulkDeleteApprovalDm } from '@/lib/mattermost-dm';
import { randomUUID } from 'crypto';
import { deleteImapMessagesBulk } from '@/lib/mail/delete-utils';
import { getSetting } from '@/lib/settings';

// POST /api/threads/bulk
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const { action, status: newStatus, ids, all, filters, validate_only } = await req.json();

  console.log(`[bulk-api] action=${action}, all=${all}, validate_only=${validate_only}, filters.type=${filters?.type}`);

  if (!action) {
    return NextResponse.json({ error: 'missing_action' }, { status: 400 });
  }

  const where = buildThreadsWhere({
    session,
    status: filters?.status,
    type: filters?.type,
    q: filters?.q,
    mine: filters?.mine === '1',
    unread: filters?.unread === '1',
    sent: filters?.sent === '1',
    assigned: filters?.assigned === '1'
  });

  // Security Check: Approval required for deleting > X% of any team mailbox's active emails
  if (action === 'delete' && filters?.type === 'team') {
    console.log('[bulk-delete-check] Protected path active');
    
    // 1. Identify which mailboxes are affected
    let affectedMailboxIds: string[] = [];
    if (all) {
      const mailboxes = await prisma.mailboxes.findMany({
        where: {
          type: 'team',
          permissions: { some: { user_id: session!.userId, can_view: true } }
        },
        select: { id: true }
      });
      affectedMailboxIds = mailboxes.map(m => m.id);
    } else if (Array.isArray(ids) && ids.length > 0) {
      const threads = await prisma.threads.findMany({
        where: { id: { in: ids } },
        select: { mailbox_id: true },
        distinct: ['mailbox_id']
      });
      affectedMailboxIds = threads.map(t => t.mailbox_id);
    }
    
    // 2. Check each affected mailbox for threshold
    let exceedsThreshold = false;
    let totalTargetCount = 0;

    const thresholdSetting = await getSetting('BULK_DELETE_THRESHOLD');
    const threshold = thresholdSetting ? parseFloat(thresholdSetting) : 0.3;

    for (const mid of affectedMailboxIds) {
      const mailboxTotal = await prisma.threads.count({
        where: { 
          mailbox_id: mid, 
          visibility: { none: { user_id: session!.userId, is_hidden: true } }
        }
      });
      
      if (mailboxTotal === 0) continue;

      let mailboxTarget = 0;
      if (all) {
        mailboxTarget = await prisma.threads.count({ 
          where: { ...where, mailbox_id: mid } 
        });
      } else if (Array.isArray(ids)) {
        mailboxTarget = await prisma.threads.count({
          where: { id: { in: ids }, mailbox_id: mid }
        });
      }

      totalTargetCount += mailboxTarget;
      const ratio = mailboxTarget / mailboxTotal;
      
      console.log(`[bulk-delete-check] Mailbox ${mid}: target=${mailboxTarget}, total=${mailboxTotal}, ratio=${ratio.toFixed(4)}, threshold=${threshold}`);

      if (ratio >= threshold) {
        exceedsThreshold = true;
      }
    }

    if (exceedsThreshold) {
      if (validate_only) {
        return NextResponse.json({ 
          ok: false, 
          error: 'approval_required_warning',
          message: `削除対象の ${totalTargetCount} 件の中に、メールボックスの${Math.round(threshold * 100)}%を超える大量削除が含まれています。実行には管理者の承認が必要ですが、リクエストを送信しますか？`
        });
      }

      const approvalId = randomUUID();
      await (prisma as any).pending_bulk_actions.create({
        data: {
          id: approvalId,
          user_id: session!.userId,
          action: 'delete',
          filters_json: JSON.stringify(filters),
          count: totalTargetCount,
          expires_at: new Date(Date.now() + 5 * 60 * 1000) // 5m
        }
      });

      const admins = await prisma.users.findMany({
        where: { role: 'admin' },
        select: { id: true, email: true }
      });

      const user = await prisma.users.findUnique({ where: { id: session!.userId }, select: { name: true } });

      for (const admin of admins) {
        await sendBulkDeleteApprovalDm(admin.id, admin.email, user?.name || '不明', totalTargetCount, approvalId).catch((e) => {
          console.error('[bulk-delete] MM notification failed', admin.email, e);
        });
      }

      return NextResponse.json({ 
        ok: false, 
        error: 'approval_required', 
        count: totalTargetCount,
        message: `削除リクエスト（${totalTargetCount}件）が送信されました。管理者の承認後に実行されます。`
      });
    }
  }

  // Actual execution logic below
  let threadIds: string[] = [];

  if (all && filters) {
    const threads = await prisma.threads.findMany({
      where,
      select: { id: true }
    });
    threadIds = threads.map(t => t.id);
  } else if (Array.isArray(ids)) {
    threadIds = ids;
  }

  if (threadIds.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  // Perform action in chunks
  const CHUNK_SIZE = 100;
  for (let i = 0; i < threadIds.length; i += CHUNK_SIZE) {
    const chunk = threadIds.slice(i, i + CHUNK_SIZE);

    if (action === 'read') {
      await Promise.all(chunk.map(async (id) => {
        await prisma.thread_reads.upsert({
          where: { thread_id_user_id: { thread_id: id, user_id: session!.userId } },
          create: { thread_id: id, user_id: session!.userId },
          update: { last_read_at: new Date() }
        });
        const t = await prisma.threads.findUnique({ where: { id }, select: { mailbox: { select: { type: true } } } });
        if (t?.mailbox.type === 'personal') {
          await prisma.threads.update({ where: { id }, data: { unread_count: 0 } });
        }
      }));
    } else if (action === 'unread') {
      await Promise.all(chunk.map(async (id) => {
        await prisma.thread_reads.deleteMany({
          where: { thread_id: id, user_id: session!.userId }
        });
        const t = await prisma.threads.findUnique({ where: { id }, select: { mailbox: { select: { type: true } } } });
        if (t?.mailbox.type === 'personal') {
          await prisma.threads.update({ where: { id }, data: { unread_count: 1 } });
        }
      }));
    } else if (action === 'status' && newStatus) {
      await prisma.threads.updateMany({
        where: { id: { in: chunk } },
        data: { status: newStatus }
      });
    } else if (action === 'delete') {
      const threadsToDelete = await prisma.threads.findMany({
        where: { id: { in: chunk } },
        include: {
          mailbox: { include: { credentials: true } },
          messages: { select: { imap_uid: true } }
        }
      });

      for (const t of threadsToDelete) {
        const id = t.id;
        const imapUids = t.messages.map(m => m.imap_uid).filter((u): u is number => u !== null);
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

        if (t.mailbox.credentials && imapUids.length > 0) {
          deleteImapMessagesBulk(t.mailbox.credentials, imapUids).catch(() => {});
        }
      }
    }
  }

  return NextResponse.json({ ok: true, count: threadIds.length });
}
