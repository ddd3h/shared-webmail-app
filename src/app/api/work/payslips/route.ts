import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';
import { isValidDateString, isValidMonth, jstDateString, payslipTotals, toDbDate } from '@/lib/work';

type Row = Awaited<ReturnType<typeof load>>[number];

function load(where: object) {
  return prisma.payslips.findMany({
    where,
    include: { items: { orderBy: { sort: 'asc' } }, user: { select: { id: true, name: true, worker_type: true } } },
    orderBy: [{ pay_month: 'desc' }, { created_at: 'desc' }],
    take: 500,
  });
}

function serializePayslip(p: Row) {
  return {
    id: p.id,
    user: p.user,
    pay_month: p.pay_month,
    title: p.title,
    status: p.status,
    pay_date: p.pay_date ? p.pay_date.toISOString().slice(0, 10) : null,
    note: p.note,
    items: p.items.map(i => ({ id: i.id, kind: i.kind, label: i.label, amount: i.amount })),
    ...payslipTotals(p.items),
  };
}

// GET /api/work/payslips?month=YYYY-MM&userId=
// Everyone can read their own statements; only admins can read other people's.
// `mine=1` limits an admin to their own statements too (the 'my payslips' tab).
// `summary` is for `month` (default: this month): what is still to be paid and what has been paid.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const admin = isAdmin(actor);

  const sp = new URL(req.url).searchParams;
  const month = sp.get('month');
  if (month && !isValidMonth(month)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const summaryMonth = month || jstDateString(new Date()).slice(0, 7);
  const userId = admin && sp.get('mine') !== '1' ? sp.get('userId') || undefined : actor.id;
  const scope = userId ? { user_id: userId } : {};

  const [items, monthRows] = await Promise.all([
    load({ ...scope, ...(month ? { pay_month: month } : {}) }),
    load({ ...scope, pay_month: summaryMonth }),
  ]);
  const sum = (status: string) => monthRows.filter(p => p.status === status).reduce((s, p) => s + payslipTotals(p.items).net, 0);
  return NextResponse.json({
    items: items.map(serializePayslip),
    summary: { month: summaryMonth, planned_total: sum('planned'), paid_total: sum('paid'), count: monthRows.length },
  });
}

const itemSchema = z.object({
  kind: z.enum(['earning', 'deduction']),
  label: z.string().trim().min(1).max(100),
  amount: z.number().int().min(0).max(1_000_000_000),
});

const createSchema = z.object({
  userId: z.string().min(1),
  pay_month: z.string().refine(isValidMonth),
  title: z.string().trim().min(1).max(100).default('給与'),
  status: z.enum(['planned', 'paid']).default('planned'),
  pay_date: z.string().refine(isValidDateString).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  items: z.array(itemSchema).min(1).max(50),
});

// POST /api/work/payslips - record a statement (admin only)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  if (!(await getActor(d.userId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const row = await prisma.payslips.create({
    data: {
      user_id: d.userId, pay_month: d.pay_month, title: d.title, status: d.status,
      pay_date: d.pay_date ? toDbDate(d.pay_date) : null, note: d.note || null, created_by_id: actor.id,
      items: { create: d.items.map((i, idx) => ({ ...i, sort: idx })) },
    },
  });
  await logAudit({
    actorUserId: actor.id, actionType: 'payslip_create', targetType: 'payslips', targetId: row.id,
    metadata: { user_id: d.userId, pay_month: d.pay_month, net: payslipTotals(d.items).net },
  });
  return NextResponse.json({ id: row.id }, { status: 201 });
}
