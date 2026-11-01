import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { fileResponse } from '@/lib/file-response';
import { canReviewRequest } from '@/lib/org-server';
import { deleteStoredFiles } from '@/lib/attachment-storage';
import { isEditable } from '@/lib/expense';

async function load(rid: string, userId: string) {
  const actor = await getActor(userId);
  const receipt = await prisma.expense_receipts.findUnique({ where: { id: rid }, include: { claim: true } });
  return { actor, receipt };
}

// GET /api/expenses/receipts/:rid - shown in the browser (images and PDF; see file-response.ts). Who may open it: the claimant, 経理担当・管理者,
// and the people who decide the claim (the approvers of the 部署 it was made for: they have to see the receipt to approve).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const session = await getSession();
  requireAuth(session);
  const { actor, receipt } = await load(rid, session.userId);
  if (!actor || !receipt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (receipt.claim.user_id !== actor.id && !isFinance(actor) && !(await canReviewRequest(actor, receipt.claim))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return fileResponse(receipt);
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
