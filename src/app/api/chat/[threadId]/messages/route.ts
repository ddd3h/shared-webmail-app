import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { resolveChatThread } from '@/lib/chat-auth';
import { broadcastChat } from '@/lib/chat-store';
import { prisma } from '@/lib/db';

async function buildDto(msgId: string) {
  const m = await prisma.chat_messages.findUnique({
    where: { id: msgId },
    include: {
      sender: { select: { id: true, name: true } },
      reads: { select: { user_id: true, read_at: true } },
    },
  });
  if (!m) return null;
  return {
    id: m.id,
    threadId: m.thread_id,
    senderId: m.sender_id,
    senderName: m.sender.name,
    body: m.body,
    kind: m.kind,
    createdAt: m.created_at.toISOString(),
    reads: m.reads.map(r => ({ userId: r.user_id, readAt: r.read_at.toISOString() })),
  };
}

// GET /api/chat/[threadId]/messages?before=<id>&limit=<n>
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const session = await getSession();
  requireAuth(session);

  const resolved = await resolveChatThread(threadId, session!.userId);
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const url = new URL(req.url);
  const before = url.searchParams.get('before') || undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);

  const cursorMsg = before
    ? await prisma.chat_messages.findUnique({ where: { id: before }, select: { created_at: true } })
    : null;

  const messages = await prisma.chat_messages.findMany({
    where: {
      thread_id: threadId,
      ...(cursorMsg
        ? {
            OR: [
              { created_at: { lt: cursorMsg.created_at } },
              { created_at: { equals: cursorMsg.created_at }, id: { lt: before! } },
            ],
          }
        : {}),
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit,
    include: {
      sender: { select: { id: true, name: true } },
      reads: { select: { user_id: true, read_at: true } },
    },
  });

  const dtos = messages.reverse().map(m => ({
    id: m.id,
    threadId: m.thread_id,
    senderId: m.sender_id,
    senderName: m.sender.name,
    body: m.body,
    kind: m.kind,
    createdAt: m.created_at.toISOString(),
    reads: m.reads.map(r => ({ userId: r.user_id, readAt: r.read_at.toISOString() })),
  }));

  return NextResponse.json({ messages: dtos, hasMore: messages.length === limit });
}

// POST /api/chat/[threadId]/messages
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
  const content = (body.body ?? '').trim();
  const kind = body.kind === 'sticker' ? 'sticker' : 'text';
  if (!content || content.length > 2000) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const msg = await prisma.chat_messages.create({
    data: {
      thread_id: threadId,
      sender_id: session!.userId,
      body: content,
      kind,
    },
  });

  // Sender has read their own message
  await prisma.chat_message_reads.create({
    data: { message_id: msg.id, user_id: session!.userId },
  });

  const dto = await buildDto(msg.id);
  if (dto) broadcastChat(threadId, { event: 'chat_message', data: dto });

  return NextResponse.json(dto, { status: 201 });
}
