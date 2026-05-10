import { NextRequest } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import * as store from '@/lib/collab-store';

export const dynamic = 'force-dynamic';

// sessionId can be a threadId or "draft-<draftId>"
async function resolveSession(sessionId: string, userId: string) {
  if (sessionId.startsWith('draft-')) {
    const draftId = sessionId.slice(6);
    const draft = await prisma.drafts.findFirst({
      where: {
        id: draftId,
        is_shared: true,
        OR: [
          { user_id: userId },
          { mailbox: { OR: [{ type: 'personal', owner_user_id: userId }, { permissions: { some: { user_id: userId, can_view: true } } }] } },
        ],
      },
      select: { id: true, yjs_state: true },
    });
    return draft ? { yjsState: draft.yjs_state } : null;
  }

  const thread = await prisma.threads.findFirst({
    where: {
      id: sessionId,
      mailbox: {
        OR: [
          { type: 'personal', owner_user_id: userId },
          { permissions: { some: { user_id: userId, can_view: true } } },
        ],
      },
    },
    select: { id: true },
  });
  if (!thread) return null;

  const draft = await prisma.drafts.findFirst({
    where: { thread_id: sessionId, is_shared: true },
    select: { yjs_state: true },
  });
  return { yjsState: draft?.yjs_state ?? null };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId: sessionId } = await params;
  const session = await getSession();
  requireAuth(session);
  const userId = session!.userId;

  const resolved = await resolveSession(sessionId, userId);
  if (!resolved) return new Response('Not found', { status: 404 });

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  let controller!: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(c) {
      controller = c;

      const me = store.join(sessionId, userId, user?.name ?? userId, controller);
      const activeUsers = store.getUsers(sessionId);

      const initPayload = {
        me,
        activeUsers,
        yjsState: resolved.yjsState ? Buffer.from(resolved.yjsState).toString('base64') : null,
      };
      c.enqueue(new TextEncoder().encode(`event: init\ndata: ${JSON.stringify(initPayload)}\n\n`));
    },
    cancel() {
      store.leave(sessionId, userId);
    },
  });

  const heartbeatTimer = setInterval(() => {
    store.heartbeat(sessionId, userId);
    try {
      controller.enqueue(new TextEncoder().encode(': ping\n\n'));
    } catch {
      clearInterval(heartbeatTimer);
    }
  }, 25_000);

  req.signal.addEventListener('abort', () => {
    clearInterval(heartbeatTimer);
    store.leave(sessionId, userId);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // disable Nginx proxy buffering for SSE
    },
  });
}
