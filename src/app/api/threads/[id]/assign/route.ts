import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { logAudit } from '@/lib/audit';
import { queues } from '@/lib/queue';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const body = await req.json().catch(() => ({}));
  const { user_id } = z.object({ user_id: z.string().nullable() }).parse(body);
  const thread = await prisma.threads.findUnique({ where: { id }, include: { mailbox: true } });
  if (!thread) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Permission: personal mailbox owner always allowed; team mailbox requires can_assign
  const isOwner = thread.mailbox.type === 'personal' && thread.mailbox.owner_user_id === session!.userId;
  if (!isOwner) {
    const perm = await prisma.mailbox_permissions.findFirst({ where: { mailbox_id: thread.mailbox_id, user_id: session!.userId, can_assign: true } });
    if (!perm) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Auto-update status: assigned → 対応中(in_progress), unassigned → 未対応(open)
  const newStatus = user_id ? 'in_progress' : 'open';

  await prisma.$transaction([
    prisma.threads.update({ where: { id: thread.id }, data: { assigned_user_id: user_id, status: newStatus } }),
    prisma.thread_assignments.create({ data: { thread_id: thread.id, assigned_to_user_id: user_id, assigned_by_user_id: session!.userId } })
  ]);

  await logAudit({ actorUserId: session!.userId, actionType: 'assign_thread', targetType: 'threads', targetId: thread.id, metadata: { assigned_to: user_id } });
  if (user_id) {
    // Notify via queues (push/mattermost)
    await queues.push.add({ name: 'push', data: { userId: user_id, title: '担当に割り当て', body: thread.subject, url: `/threads/${thread.id}`, priority: 'high' } });
    await queues.mattermost.add({ name: 'mm_notify', data: { userId: user_id, threadId: thread.id, type: 'assigned' } });
  }
  return NextResponse.json({ ok: true });
}

