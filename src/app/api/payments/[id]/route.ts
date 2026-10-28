import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { deleteStoredFiles } from '@/lib/attachment-storage';
import { isValidDateString, toDbDate } from '@/lib/work';
import { MAX_AMOUNT, isValidBreakdown } from '@/lib/payment';
import { notifyPaymentSubmitted } from '@/lib/work-notify';

const editable = (s: string) => s === 'pending' || s === 'rejected';

const schema = z.object({
  vendor_id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  amount: z.number().int().min(1).max(MAX_AMOUNT),
  deduction_amount: z.number().int().min(0).max(MAX_AMOUNT).default(0),
  fee: z.number().int().min(0).max(1_000_000).default(0),
  fee_bearer: z.enum(['us', 'vendor']).default('us'),
  invoice_number: z.string().trim().max(100).nullable().optional(),
  invoice_date: z.string().refine(isValidDateString).nullable().optional(),
  due_date: z.string().refine(isValidDateString),
  description: z.string().trim().max(2000).nullable().optional(),
});

// PATCH /api/payments/:id - the applicant edits a pending or rejected request (a rejected one is resubmitted)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const r = await prisma.payment_requests.findUnique({ where: { id } });
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (r.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!editable(r.status)) return NextResponse.json({ error: 'not_editable' }, { status: 409 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  if (!isValidBreakdown(d)) return NextResponse.json({ error: 'invalid_breakdown' }, { status: 400 });

  const vendor = await prisma.payment_vendors.findUnique({ where: { id: d.vendor_id }, select: { is_active: true } });
  if (!vendor || !vendor.is_active) return NextResponse.json({ error: 'invalid_vendor' }, { status: 400 });
  if (d.invoice_number) {
    const dup = await prisma.payment_requests.findFirst({
      where: { id: { not: id }, vendor_id: d.vendor_id, invoice_number: d.invoice_number, status: { in: ['pending', 'approved', 'paid'] } }, select: { id: true },
    });
    if (dup) return NextResponse.json({ error: 'duplicate_invoice' }, { status: 409 });
  }
  await prisma.payment_requests.update({
    where: { id },
    data: {
      vendor_id: d.vendor_id, title: d.title, amount: d.amount, deduction_amount: d.deduction_amount, fee: d.fee, fee_bearer: d.fee_bearer,
      invoice_number: d.invoice_number || null, invoice_date: d.invoice_date ? toDbDate(d.invoice_date) : null,
      due_date: toDbDate(d.due_date), description: d.description || null,
      status: 'pending', reviewed_by_id: null, reviewed_at: null, review_comment: null,
    },
  });
  if (r.status === 'rejected') void notifyPaymentSubmitted(id, true);
  return NextResponse.json({ ok: true });
}

// DELETE /api/payments/:id - withdraw your own pending or rejected request
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const r = await prisma.payment_requests.findUnique({ where: { id }, include: { documents: true } });
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (r.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!editable(r.status)) return NextResponse.json({ error: 'not_deletable' }, { status: 409 });
  await prisma.payment_requests.delete({ where: { id } });
  await deleteStoredFiles(r.documents.map(x => x.storage_key));
  return NextResponse.json({ ok: true });
}
