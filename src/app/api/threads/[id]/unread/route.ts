import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// POST /api/threads/[id]/unread — mark thread as unread for current user
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const thread = await prisma.threads.findUnique({ where: { id }, include: { mailbox: true } });
  if (!thread) return NextResponse.json({ ok: true });

  if (thread.mailbox.type === 'team') {
    // Remove per-user read record so thread appears unread
    await prisma.thread_reads.deleteMany({
      where: { thread_id: id, user_id: session!.userId }
    });
  } else {
    // Personal: set unread_count to 1
    await prisma.threads.update({ where: { id }, data: { unread_count: 1 } });
  }

  return NextResponse.json({ ok: true });
}
