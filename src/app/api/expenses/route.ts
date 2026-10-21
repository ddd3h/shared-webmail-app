import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin } from '@/lib/work-auth';
import { saveUploadedFiles, deleteStoredFiles } from '@/lib/attachment-storage';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachment-limits';
import { isValidDateString, isValidMonth, monthRange, toDbDate } from '@/lib/work';
import { notifyExpenseSubmitted } from '@/lib/work-notify';
import { EXPENSE_CATEGORIES, MAX_AMOUNT, MAX_RECEIPTS, isReceiptType, summarize } from '@/lib/expense';

const include = {
  user: { select: { id: true, name: true } },
  reviewer: { select: { name: true } },
  payslip: { select: { id: true, pay_month: true, title: true, status: true } },
  receipts: { select: { id: true, filename: true, content_type: true, size: true }, orderBy: { created_at: 'asc' as const } },
};

function serialize(c: any) {
  return {
    id: c.id,
    user: c.user,
    expense_date: c.expense_date.toISOString().slice(0, 10),
    category: c.category,
    title: c.title,
    amount: c.amount,
    payment_method: c.payment_method,
    description: c.description,
    status: c.status,
    reviewer: c.reviewer?.name ?? null,
    reviewed_at: c.reviewed_at,
    review_comment: c.review_comment,
    reimbursed_at: c.reimbursed_at ? c.reimbursed_at.toISOString().slice(0, 10) : null,
    reimburse_note: c.reimburse_note,
    payslip: c.payslip ?? null,
    receipts: c.receipts,
    created_at: c.created_at,
  };
}

// GET /api/expenses?scope=mine|all&status=&month=YYYY-MM&userId=
// `mine` (default) is the caller's own claims; `all` is admin only.
// `summary` always covers the whole scope (not the status/month filter).
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  const all = sp.get('scope') === 'all';
  if (all && !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const month = sp.get('month');
  if (month && !isValidMonth(month)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const status = sp.get('status');
  if (status && !['pending', 'approved', 'rejected', 'paid', 'to_reimburse', 'in_payslip', 'owed'].includes(status)) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }

  const scope = all ? (sp.get('userId') ? { user_id: sp.get('userId')! } : {}) : { user_id: actor.id };
  const filter: any = { ...scope };
  if (month) { const { start, end } = monthRange(month); filter.expense_date = { gte: start, lt: end }; }
  // to_reimburse: nothing done yet / in_payslip: merged into an unpaid statement / owed: both
  if (status === 'to_reimburse') { filter.status = 'approved'; filter.payment_method = 'personal'; filter.payslip_id = null; }
  else if (status === 'in_payslip') { filter.status = 'approved'; filter.payment_method = 'personal'; filter.payslip_id = { not: null }; }
  else if (status === 'owed') { filter.status = 'approved'; filter.payment_method = 'personal'; }
  else if (status) filter.status = status;

  const [rows, scoped] = await Promise.all([
    prisma.expense_claims.findMany({ where: filter, include, orderBy: [{ expense_date: 'desc' }, { created_at: 'desc' }], take: 500 }),
    prisma.expense_claims.findMany({ where: scope, select: { status: true, payment_method: true, amount: true, payslip_id: true, user_id: true, user: { select: { name: true } } } }),
  ]);

  let byUser: { user_id: string; name: string; count: number; amount: number }[] | undefined;
  if (all) {
    const map = new Map<string, { user_id: string; name: string; count: number; amount: number }>();
    for (const c of scoped) {
      if (c.status !== 'approved' || c.payment_method !== 'personal' || c.payslip_id) continue;
      const e = map.get(c.user_id) ?? { user_id: c.user_id, name: c.user.name, count: 0, amount: 0 };
      e.count++; e.amount += c.amount; map.set(c.user_id, e);
    }
    byUser = [...map.values()].sort((a, b) => b.amount - a.amount);
  }
  return NextResponse.json({ items: rows.map(serialize), summary: summarize(scoped), to_reimburse_by_user: byUser });
}

const fieldsSchema = z.object({
  expense_date: z.string().refine(isValidDateString),
  category: z.enum(EXPENSE_CATEGORIES),
  title: z.string().trim().min(1).max(200),
  amount: z.coerce.number().int().min(1).max(MAX_AMOUNT),
  payment_method: z.enum(['personal', 'company']),
  description: z.string().trim().max(2000).optional(),
});

// POST /api/expenses - submit a claim (multipart: fields + `file` receipts)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let fd: FormData;
  try { fd = await req.formData(); } catch { return NextResponse.json({ error: 'file_too_large' }, { status: 413 }); }
  const parsed = fieldsSchema.safeParse(Object.fromEntries(['expense_date', 'category', 'title', 'amount', 'payment_method', 'description'].map(k => [k, fd.get(k) ?? undefined])));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const files = fd.getAll('file').filter(f => f instanceof File && (f as File).size > 0) as File[];
  if (files.length > MAX_RECEIPTS) return NextResponse.json({ error: 'too_many_files' }, { status: 400 });
  if (files.some(f => f.size > MAX_ATTACHMENT_BYTES)) return NextResponse.json({ error: 'file_too_large' }, { status: 400 });
  if (files.some(f => !isReceiptType(f.type))) return NextResponse.json({ error: 'invalid_file_type' }, { status: 400 });

  const d = parsed.data;
  const saved = await saveUploadedFiles(files);
  try {
    const row = await prisma.expense_claims.create({
      data: {
        user_id: actor.id, expense_date: toDbDate(d.expense_date), category: d.category, title: d.title,
        amount: d.amount, payment_method: d.payment_method, description: d.description || null,
        receipts: { create: saved },
      },
    });
    void notifyExpenseSubmitted(row.id);
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    await deleteStoredFiles(saved.map(s => s.storage_key));
    throw e;
  }
}

