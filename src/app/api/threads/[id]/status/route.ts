import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const { status } = z.object({ status: z.enum(['open','in_progress','waiting','done']) }).parse(await req.json().catch(() => ({})));
  const t = await prisma.threads.findUnique({ where: { id }, include: { mailbox: true } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // View permission required
  const canView = await prisma.mailboxes.findFirst({ where: { id: t.mailbox_id, OR: [{ type: 'personal', owner_user_id: session!.userId }, { permissions: { some: { user_id: session!.userId, can_view: true } } }] } });
  if (!canView) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await prisma.$transaction([
    prisma.threads.update({ where: { id: t.id }, data: { status } }),
    prisma.thread_state_history.create({ data: { thread_id: t.id, old_status: t.status as any, new_status: status as any, changed_by_user_id: session!.userId } })
  ]);
  await logAudit({ actorUserId: session!.userId, actionType: 'change_status', targetType: 'threads', targetId: t.id, metadata: { old: t.status, new: status } });
  return NextResponse.json({ ok: true });
}
