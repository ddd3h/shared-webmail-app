import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import path from 'path';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { APP_ROOT } from '@/lib/app-root';
import { deleteStoredFiles } from '@/lib/attachment-storage';
import { isEditable } from '@/lib/expense';

async function load(rid: string, userId: string) {
  const actor = await getActor(userId);
  const receipt = await prisma.expense_receipts.findUnique({ where: { id: rid }, include: { claim: true } });
  return { actor, receipt };
}

// GET /api/expenses/receipts/:rid - download (claimant or admin). Always an attachment, never rendered inline.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const session = await getSession();
  requireAuth(session);
  const { actor, receipt } = await load(rid, session.userId);
  if (!actor || !receipt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (receipt.claim.user_id !== actor.id && !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const stream = createReadStream(path.join(APP_ROOT, receipt.storage_key));
  return new NextResponse(stream as any, {
    headers: {
      'Content-Type': receipt.content_type,
      'Content-Length': String(receipt.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(receipt.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// DELETE /api/expenses/receipts/:rid - remove a receipt from your own pending/rejected claim
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const session = await getSession();
  requireAuth(session);
  const { actor, receipt } = await load(rid, session.userId);
  if (!actor || !receipt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (receipt.claim.user_id !== actor.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!isEditable(receipt.claim)) return NextResponse.json({ error: 'not_editable' }, { status: 409 });
  await prisma.expense_receipts.delete({ where: { id: rid } });
  await deleteStoredFiles([receipt.storage_key]);
  return NextResponse.json({ ok: true });
}
