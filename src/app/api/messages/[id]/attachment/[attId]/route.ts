import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { createReadStream } from 'fs';
import path from 'path';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const { id, attId } = await params;
  const session = await getSession();
  requireAuth(session);
  const msg = await prisma.messages.findUnique({ where: { id }, include: { mailbox: true } });
  if (!msg) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const canView = await prisma.mailboxes.findFirst({ where: { id: msg.mailbox_id, OR: [{ owner_user_id: session!.userId }, { permissions: { some: { user_id: session!.userId, can_view: true } } }] } });
  if (!canView) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const att = await prisma.attachments.findUnique({ where: { id: attId } });
  if (!att || att.message_id !== msg.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const abs = path.join(process.cwd(), att.storage_key);
  const stream = createReadStream(abs);
  const res = new NextResponse(stream as any, { headers: { 'Content-Type': att.content_type, 'Content-Length': String(att.size), 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}` } });
  return res;
}

