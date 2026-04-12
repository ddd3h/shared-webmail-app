import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { queues } from '@/lib/queue';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const { channel_id, message_id } = await req.json().catch(() => ({}));
  const thread = await prisma.threads.findUnique({ where: { id } });
  if (!thread) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await queues.mattermost.add({ name: 'mm_forward', data: { userId: session!.userId, threadId: thread.id, type: 'forward' } });
  await prisma.mattermost_forwards.create({ data: { thread_id: thread.id, message_id: message_id || null, forwarded_by_user_id: session!.userId, target_channel_id: channel_id || '', status: 'pending' } });
  await logAudit({ actorUserId: session!.userId, actionType: 'mm_forward', targetType: 'threads', targetId: thread.id, metadata: { channel_id } });
  return NextResponse.json({ ok: true });
}

