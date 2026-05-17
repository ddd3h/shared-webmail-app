import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { resolveChatThread } from '@/lib/chat-auth';
import { broadcastChat } from '@/lib/chat-store';
import { prisma } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const session = await getSession();
  requireAuth(session);

  const resolved = await resolveChatThread(threadId, session!.userId);
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const messageIds: string[] = Array.isArray(body.message_ids) ? body.message_ids : [];
  if (messageIds.length === 0) return NextResponse.json({ ok: true });

  const readAt = new Date();
  await prisma.chat_message_reads.createMany({
    data: messageIds.map(id => ({ message_id: id, user_id: session!.userId, read_at: readAt })),
    skipDuplicates: true,
  });

  broadcastChat(threadId, {
    event: 'chat_read',
    data: {
      userId: session!.userId,
      messageIds,
      readAt: readAt.toISOString(),
    },
  });

  return NextResponse.json({ ok: true });
}
