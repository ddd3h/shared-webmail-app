import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { resolveChatThread } from '@/lib/chat-auth';
import { joinChat, leaveChat, heartbeatChat, getChatUsers } from '@/lib/chat-store';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const session = await getSession();
  requireAuth(session);

  const resolved = await resolveChatThread(threadId, session!.userId);
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const user = await prisma.users.findUnique({
    where: { id: session!.userId },
    select: { id: true, name: true },
  });
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Load last 50 messages with reads
  const messages = await prisma.chat_messages.findMany({
    where: { thread_id: threadId },
    orderBy: { created_at: 'asc' },
    take: 50,
    include: {
      sender: { select: { id: true, name: true } },
      reads: { select: { user_id: true, read_at: true } },
    },
  });

  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      const me = joinChat(threadId, user.id, user.name, controller);
      const participants = getChatUsers(threadId);

      const initData = {
        me,
        participants,
        messages: messages.map(m => ({
          id: m.id,
          threadId: m.thread_id,
          senderId: m.sender_id,
          senderName: m.sender.name,
          body: m.body,
          kind: m.kind,
          createdAt: m.created_at.toISOString(),
          reads: m.reads.map(r => ({ userId: r.user_id, readAt: r.read_at.toISOString() })),
        })),
      };

      ctrl.enqueue(encoder.encode(`event: init\ndata: ${JSON.stringify(initData)}\n\n`));

      const heartbeatInterval = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(': ping\n\n'));
          heartbeatChat(threadId, user.id);
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 25_000);

      // Cleanup on close
      _req.signal.addEventListener('abort', () => {
        clearInterval(heartbeatInterval);
        try { leaveChat(threadId, user.id); } catch { /* ignore */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
