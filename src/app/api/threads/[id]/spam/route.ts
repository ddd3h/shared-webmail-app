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

  // Get sender email from first incoming message
  const firstIncoming = await prisma.messages.findFirst({
    where: { thread_id: id, direction: 'incoming' },
    orderBy: { created_at: 'asc' },
    select: { from_email: true }
  });

  await prisma.$transaction(async (tx) => {
    await tx.threads.update({
      where: { id },
      data: { is_spam: true, spam_reason: 'manual', spam_flagged_at: new Date() }
    });

    if (firstIncoming?.from_email) {
      await tx.spam_senders.upsert({
        where: { type_address: { type: 'blocklist', address: firstIncoming.from_email.toLowerCase() } },
        create: {
          type: 'blocklist',
          address: firstIncoming.from_email.toLowerCase(),
          note: '手動マーク',
          created_by_id: session!.userId,
        },
        update: {}
      });
    }
  });

  return NextResponse.json({ ok: true, blocklisted: firstIncoming?.from_email ?? null });
}
