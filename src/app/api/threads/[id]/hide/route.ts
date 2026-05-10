import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const t = await prisma.threads.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const canAccess = await prisma.mailboxes.findFirst({
    where: {
      id: t.mailbox_id,
      OR: [
        { type: 'personal', owner_user_id: session!.userId },
        { permissions: { some: { user_id: session!.userId, can_view: true } } }
      ]
    }
  });
  if (!canAccess) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await prisma.thread_visibility.upsert({
    where: { thread_id_user_id: { thread_id: t.id, user_id: session!.userId } },
    create: { thread_id: t.id, user_id: session!.userId, is_hidden: true, hidden_at: new Date() },
    update: { is_hidden: true, hidden_at: new Date() }
  });
  return NextResponse.json({ ok: true });
}

