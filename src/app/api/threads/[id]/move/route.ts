import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { canViewMailbox } from '@/lib/rbac';

// POST /api/threads/[id]/move
// Moves a thread into a team mailbox: from the person's own mailbox, or from another team mailbox they are a member of.
// The target must be a team mailbox the person is a member of too (nothing can be pushed into a mailbox they cannot see).
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

  // Out of a personal mailbox: only its owner (an admin has no way into other people's mailboxes).
  // Out of a team mailbox: a member who can see it (the same right as deleting its mail).
  const fromPersonal = thread.mailbox.type === 'personal';
  const mayMove = fromPersonal ? thread.mailbox.owner_user_id === session!.userId : await canViewMailbox(session!.userId, thread.mailbox_id);
  if (!mayMove) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (target_mailbox_id === thread.mailbox_id) return NextResponse.json({ error: 'same_mailbox' }, { status: 400 });

  // Verify target is a team mailbox
  const target = await prisma.mailboxes.findUnique({ where: { id: target_mailbox_id } });
  if (!target) return NextResponse.json({ error: 'target_not_found' }, { status: 404 });
  if (target.type !== 'team') return NextResponse.json({ error: 'target_not_team' }, { status: 400 });
  // and only into a team mailbox they belong to (mail pushed into one they cannot see would be a way to plant content there)
  if (!(await canViewMailbox(session!.userId, target_mailbox_id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // An assignee who cannot see the target mailbox would be holding a thread they cannot open: the assignment ends.
  const assignee = thread.assigned_user_id;
  const dropAssignee = !!assignee && !(await canViewMailbox(assignee, target_mailbox_id));

  const messageIds = thread.messages.map(m => m.id);

  await prisma.$transaction([
    // Re-assign thread to target mailbox
    prisma.threads.update({
      where: { id },
      data: { mailbox_id: target_mailbox_id, ...(dropAssignee ? { assigned_user_id: null } : {}) }
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
    metadata: { from_mailbox: thread.mailbox_id, to_mailbox: target_mailbox_id, ...(dropAssignee ? { assignee_removed: assignee } : {}) }
  });

  return NextResponse.json({ ok: true });
}
