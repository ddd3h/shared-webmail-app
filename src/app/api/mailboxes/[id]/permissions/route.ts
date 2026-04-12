import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// PUT: upsert permissions for a mailbox
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: mailboxId } = await params;
  const session = await getSession();
  requireAuth(session);
  // TODO: check admin or owner rights; for MVP, owner can manage
  const [mb, user] = await Promise.all([
    prisma.mailboxes.findUnique({ where: { id: mailboxId } }),
    prisma.users.findUnique({ where: { id: session!.userId } })
  ]);
  if (!mb) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(user?.role === 'admin' || mb.owner_user_id === session!.userId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const list: Array<{ user_id: string; can_view?: boolean; can_reply?: boolean; can_assign?: boolean }> = body.items || [];
  for (const it of list) {
    if (!it.user_id) continue;
    await prisma.mailbox_permissions.upsert({
      where: { mailbox_id_user_id: { mailbox_id: mailboxId, user_id: it.user_id } },
      create: { mailbox_id: mailboxId, user_id: it.user_id, can_view: !!it.can_view, can_reply: !!it.can_reply, can_assign: !!it.can_assign },
      update: { can_view: !!it.can_view, can_reply: !!it.can_reply, can_assign: !!it.can_assign }
    });
  }
  return NextResponse.json({ ok: true });
}
