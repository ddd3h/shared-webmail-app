import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import path from 'path';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { APP_ROOT } from '@/lib/app-root';
import { deleteStoredFiles } from '@/lib/attachment-storage';

async function load(did: string, userId: string) {
  const actor = await getActor(userId);
  const doc = await prisma.payment_documents.findUnique({ where: { id: did }, include: { request: true } });
  return { actor, doc };
}

// GET /api/payments/documents/:did - download (applicant or admin). Always an attachment, never rendered inline.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ did: string }> }) {
  const { did } = await params;
  const session = await getSession();
  requireAuth(session);
  const { actor, doc } = await load(did, session.userId);
  if (!actor || !doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.request.user_id !== actor.id && !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return new NextResponse(createReadStream(path.join(APP_ROOT, doc.storage_key)) as any, {
    headers: {
      'Content-Type': doc.content_type,
      'Content-Length': String(doc.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// DELETE /api/payments/documents/:did - remove an invoice from your own pending/rejected request
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ did: string }> }) {
  const { did } = await params;
  const session = await getSession();
  requireAuth(session);
  const { actor, doc } = await load(did, session.userId);
  if (!actor || !doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.request.user_id !== actor.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (doc.request.status !== 'pending' && doc.request.status !== 'rejected') return NextResponse.json({ error: 'not_editable' }, { status: 409 });
  await prisma.payment_documents.delete({ where: { id: did } });
  await deleteStoredFiles([doc.storage_key]);
  return NextResponse.json({ ok: true });
}
