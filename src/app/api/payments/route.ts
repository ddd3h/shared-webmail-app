import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { saveUploadedFiles, deleteStoredFiles } from '@/lib/attachment-storage';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachment-limits';
import { isReceiptType } from '@/lib/expense';
import { isValidDateString, jstDateString, toDbDate } from '@/lib/work';
import { MAX_AMOUNT, MAX_DOCUMENTS, isValidBreakdown, transferAmount } from '@/lib/payment';
import { requestInclude, serializeRequest } from '@/lib/payment-server';
import { notifyPaymentSubmitted } from '@/lib/work-notify';

// GET /api/payments?scope=mine|all&status=   (`all` is admin only; status may be pending|approved|rejected|paid)
// `summary` covers the whole scope: amounts are what actually gets transferred.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const admin = isFinance(actor); // finance staff (admins + 経理担当) see every request in full

  const sp = new URL(req.url).searchParams;
  const all = sp.get('scope') === 'all';
  if (all && !admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const status = sp.get('status');
  if (status && !['pending', 'approved', 'rejected', 'paid'].includes(status)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const scope = all ? {} : { user_id: actor.id };

  const [rows, scoped] = await Promise.all([
    prisma.payment_requests.findMany({
      where: { ...scope, ...(status ? { status } : {}) }, include: requestInclude,
      orderBy: [{ due_date: status === 'paid' ? 'desc' : 'asc' }, { created_at: 'desc' }], take: 500,
    }),
    prisma.payment_requests.findMany({ where: scope, select: { status: true, amount: true, deduction_amount: true, fee: true, fee_bearer: true, due_date: true } }),
  ]);
  const today = jstDateString(new Date());
  const sum = (st: string) => {
    const r = scoped.filter(x => x.status === st);
    return { count: r.length, amount: r.reduce((s, x) => s + transferAmount(x), 0) };
  };
  const overdue = scoped.filter(x => x.status === 'approved' && x.due_date.toISOString().slice(0, 10) < today).length;
  return NextResponse.json({
    items: await Promise.all(rows.map(r => serializeRequest(r, admin))),
    summary: { pending: sum('pending'), approved: sum('approved'), paid: sum('paid'), overdue },
  });
}

const fieldsSchema = z.object({
  vendor_id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  amount: z.coerce.number().int().min(1).max(MAX_AMOUNT),
  deduction_amount: z.coerce.number().int().min(0).max(MAX_AMOUNT).default(0),
  fee: z.coerce.number().int().min(0).max(1_000_000).default(0),
  fee_bearer: z.enum(['us', 'vendor']).default('us'),
  invoice_number: z.string().trim().max(100).optional(),
  invoice_date: z.string().refine(isValidDateString).optional(),
  due_date: z.string().refine(isValidDateString),
  description: z.string().trim().max(2000).optional(),
});

// POST /api/payments - submit a transfer request (multipart: fields + `file` invoices)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let fd: FormData;
  try { fd = await req.formData(); } catch { return NextResponse.json({ error: 'file_too_large' }, { status: 413 }); }
  const keys = ['vendor_id', 'title', 'amount', 'deduction_amount', 'fee', 'fee_bearer', 'invoice_number', 'invoice_date', 'due_date', 'description'];
  const parsed = fieldsSchema.safeParse(Object.fromEntries(keys.map(k => [k, fd.get(k) || undefined])));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  if (!isValidBreakdown(d)) return NextResponse.json({ error: 'invalid_breakdown' }, { status: 400 });

  const files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
  if (files.length > MAX_DOCUMENTS) return NextResponse.json({ error: 'too_many_files' }, { status: 400 });
  if (files.some(f => f.size > MAX_ATTACHMENT_BYTES)) return NextResponse.json({ error: 'file_too_large' }, { status: 400 });
  if (files.some(f => !isReceiptType(f.type))) return NextResponse.json({ error: 'invalid_file_type' }, { status: 400 });

  const vendor = await prisma.payment_vendors.findUnique({ where: { id: d.vendor_id }, select: { is_active: true } });
  if (!vendor || !vendor.is_active) return NextResponse.json({ error: 'invalid_vendor' }, { status: 400 });
  if (d.invoice_number) {
    // The same invoice must never be paid twice.
    const dup = await prisma.payment_requests.findFirst({
      where: { vendor_id: d.vendor_id, invoice_number: d.invoice_number, status: { in: ['pending', 'approved', 'paid'] } }, select: { id: true },
    });
    if (dup) return NextResponse.json({ error: 'duplicate_invoice' }, { status: 409 });
  }

  const saved = await saveUploadedFiles(files);
  try {
    const row = await prisma.payment_requests.create({
      data: {
        user_id: actor.id, vendor_id: d.vendor_id, title: d.title, amount: d.amount, deduction_amount: d.deduction_amount,
        fee: d.fee, fee_bearer: d.fee_bearer, invoice_number: d.invoice_number || null,
        invoice_date: d.invoice_date ? toDbDate(d.invoice_date) : null, due_date: toDbDate(d.due_date),
        description: d.description || null, documents: { create: saved },
      },
    });
    void notifyPaymentSubmitted(row.id);
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    await deleteStoredFiles(saved.map(s => s.storage_key));
    throw e;
  }
}
