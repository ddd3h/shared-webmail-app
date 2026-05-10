import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';

// POST /api/threads/[id]/move
// Moves a personal mailbox thread to a team mailbox.
// { target_mailbox_id: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const { target_mailbox_id } = await req.json().catch(() => ({}));
  if (!target_mailbox_id) return NextResponse.json({ error: 'missing_target' }, { status: 400 });

  const thread = await prisma.threads.findUnique({
    where: { id },
    include: { mailbox: true, messages: { select: { id: true } } }
  });
  if (!thread) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Only owner of personal mailbox (or admin) can move
  const isOwner = thread.mailbox.type === 'personal' && thread.mailbox.owner_user_id === session!.userId;
  const actor = await prisma.users.findUnique({ where: { id: session!.userId }, select: { role: true } });
  if (!isOwner && actor?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (thread.mailbox.type !== 'personal') return NextResponse.json({ error: 'not_personal' }, { status: 400 });

  // Verify target is a team mailbox
  const target = await prisma.mailboxes.findUnique({ where: { id: target_mailbox_id } });
  if (!target) return NextResponse.json({ error: 'target_not_found' }, { status: 404 });
  if (target.type !== 'team') return NextResponse.json({ error: 'target_not_team' }, { status: 400 });

  const messageIds = thread.messages.map(m => m.id);

  await prisma.$transaction([
    // Re-assign thread to target mailbox
    prisma.threads.update({
      where: { id },
      data: { mailbox_id: target_mailbox_id }
    }),
    // Re-assign all messages
    prisma.messages.updateMany({
      where: { id: { in: messageIds } },
      data: { mailbox_id: target_mailbox_id }
    }),
  ]);

  await logAudit({
    actorUserId: session!.userId,
    actionType: 'move_thread',
    targetType: 'threads',
    targetId: id,
    metadata: { from_mailbox: thread.mailbox_id, to_mailbox: target_mailbox_id }
  });

  return NextResponse.json({ ok: true });
}
