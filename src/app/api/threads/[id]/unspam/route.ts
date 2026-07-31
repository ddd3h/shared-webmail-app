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

  // Also remove this thread's incoming senders from the blocklist, so a
  // mistakenly-marked sender isn't silenced forever
  const incoming = await prisma.messages.findMany({
    where: { thread_id: id, direction: 'incoming' },
    select: { from_email: true }
  });
  const addresses = [...new Set(incoming.map(m => m.from_email.toLowerCase()).filter(Boolean))];

  await prisma.$transaction([
    prisma.threads.update({
      where: { id },
      data: { is_spam: false, spam_reason: null, spam_flagged_at: null }
    }),
    prisma.spam_senders.deleteMany({
      where: { type: 'blocklist', address: { in: addresses } }
    })
  ]);

  return NextResponse.json({ ok: true, unblocked: addresses });
}
