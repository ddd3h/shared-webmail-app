import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { resolveChatThread } from '@/lib/chat-auth';
import { setTyping, clearTyping } from '@/lib/chat-store';
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

  const user = await prisma.users.findUnique({
    where: { id: session!.userId },
    select: { name: true },
  });
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body.isTyping) {
    setTyping(threadId, session!.userId, user.name);
  } else {
    clearTyping(threadId, session!.userId, user.name);
  }

  return NextResponse.json({ ok: true });
}
