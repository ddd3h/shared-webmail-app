import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const [mailbox, user] = await Promise.all([
    prisma.mailboxes.findUnique({ where: { id } }),
    prisma.users.findUnique({ where: { id: session!.userId } })
  ]);
  if (!mailbox) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(user?.role === 'admin' || mailbox.owner_user_id === session!.userId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const perms = await prisma.mailbox_permissions.findMany({ where: { mailbox_id: id }, select: { user_id: true, can_view: true, can_reply: true, can_assign: true } });
  return NextResponse.json({ items: perms });
}
