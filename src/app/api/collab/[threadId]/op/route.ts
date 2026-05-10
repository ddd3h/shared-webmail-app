import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import * as store from '@/lib/collab-store';
import * as Y from 'yjs';

async function canAccessSession(sessionId: string, userId: string) {
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
      select: { id: true },
    });
    return !!draft;
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
  return !!thread;
}

async function mergeYjsUpdate(sessionId: string, userId: string, updateBytes: Buffer) {
  const isDraft = sessionId.startsWith('draft-');
  const draftWhere = isDraft
    ? { id: sessionId.slice(6), is_shared: true }
    : { thread_id: sessionId, is_shared: true };

  const existing = await prisma.drafts.findFirst({ where: draftWhere, select: { id: true, yjs_state: true } });

  const doc = new Y.Doc();
  if (existing?.yjs_state) Y.applyUpdate(doc, new Uint8Array(existing.yjs_state));
  Y.applyUpdate(doc, updateBytes);

  const newState = Buffer.from(Y.encodeStateAsUpdate(doc));
  const htmlBody = doc.getText('body').toString();

  if (existing) {
    await prisma.drafts.update({
      where: { id: existing.id },
      data: { yjs_state: newState, html_body: htmlBody },
    });
  } else if (!isDraft) {
    await prisma.drafts.create({
      data: { thread_id: sessionId, user_id: userId, is_shared: true, yjs_state: newState, html_body: htmlBody },
    });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId: sessionId } = await params;
  const session = await getSession();
  requireAuth(session);
  const userId = session!.userId;

  if (!(await canAccessSession(sessionId, userId))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.type) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  if (body.type === 'update') {
    const updateBytes = Buffer.from(body.update as string, 'base64');
    await mergeYjsUpdate(sessionId, userId, updateBytes);
    store.broadcast(sessionId, { event: 'update', data: { update: body.update, userId } }, userId);
  } else if (body.type === 'awareness') {
    store.broadcast(sessionId, { event: 'awareness', data: { awareness: body.awareness, userId } }, userId);
  } else {
    return NextResponse.json({ error: 'unknown_type' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
