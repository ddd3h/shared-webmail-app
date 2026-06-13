import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// GET /api/mailboxes/[id]/reply-users
// Returns users with can_reply permission, with their effective signatures.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  requireAuth(session);
  const userId = session!.userId;
  const { id: mailboxId } = await params;

  const mailbox = await prisma.mailboxes.findFirst({
    where: {
      id: mailboxId,
      OR: [
        { type: 'personal', owner_user_id: userId },
        { permissions: { some: { user_id: userId, can_view: true } } },
      ],
    },
    select: { id: true },
  });
  if (!mailbox) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const perms = await prisma.mailbox_permissions.findMany({
    where: { mailbox_id: mailboxId, can_reply: true },
    select: {
      user: { select: { id: true, name: true, email: true, signature: true } },
    },
    orderBy: { user: { name: 'asc' } },
  });

  const users = perms.map(p => ({
    id: p.user.id,
    name: p.user.name,
    signature:
      p.user.signature ??
      (p.user.name ? `${p.user.name}${p.user.email ? '\n' + p.user.email : ''}` : ''),
  }));

  return NextResponse.json(users);
}
