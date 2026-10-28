import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { senderAddresses, whitelistUpserts } from '@/lib/spam-whitelist';

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

  // This thread's incoming senders leave the blocklist, so a mistakenly-marked sender isn't silenced forever,
  // and go on the whitelist, so the next mail from them is not judged as spam again
  const incoming = await prisma.messages.findMany({
    where: { thread_id: id, direction: 'incoming' },
    select: { from_email: true }
  });
  const addresses = senderAddresses(incoming);

  await prisma.$transaction([
    prisma.threads.update({
      where: { id },
      data: { is_spam: false, spam_reason: null, spam_flagged_at: null }
    }),
    prisma.spam_senders.deleteMany({
      where: { type: 'blocklist', address: { in: addresses } }
    }),
    ...whitelistUpserts(addresses, session!.userId)
  ]);

  return NextResponse.json({ ok: true, unblocked: addresses, whitelisted: addresses });
}
