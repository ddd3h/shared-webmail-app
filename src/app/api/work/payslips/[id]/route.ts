import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';
import { notifyPayslip } from '@/lib/work-notify';
import { isValidDateString, isValidMonth, payslipTotals, toDbDate } from '@/lib/work';

const schema = z.object({
  pay_month: z.string().refine(isValidMonth),
  title: z.string().trim().min(1).max(100),
  status: z.enum(['planned', 'paid']),
  pay_date: z.string().refine(isValidDateString).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  items: z.array(z.object({
    kind: z.enum(['earning', 'deduction']),
    label: z.string().trim().min(1).max(100),
    amount: z.number().int().min(0).max(1_000_000_000),
  })).min(1).max(50),
});

async function adminOnly() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  return actor && isAdmin(actor) ? actor : null;
}

// PUT /api/work/payslips/:id - replace a statement (admin only)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminOnly();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const existing = await prisma.payslips.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.$transaction([
    prisma.payslip_items.deleteMany({ where: { payslip_id: id } }),
    prisma.payslips.update({
      where: { id },
      data: {
        pay_month: d.pay_month, title: d.title, status: d.status,
        pay_date: d.pay_date ? toDbDate(d.pay_date) : null, note: d.note || null,
        items: { create: d.items.map((i, idx) => ({ ...i, sort: idx })) },
      },
    }),
  ]);
  await logAudit({
    actorUserId: actor.id, actionType: 'payslip_update', targetType: 'payslips', targetId: id,
    metadata: { user_id: existing.user_id, pay_month: d.pay_month, net: payslipTotals(d.items).net },
  });
  if (existing.status !== 'paid' && d.status === 'paid') void notifyPayslip(id, 'paid');
  return NextResponse.json({ ok: true });
}

// DELETE /api/work/payslips/:id (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminOnly();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const existing = await prisma.payslips.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.payslips.delete({ where: { id } });
  await logAudit({
    actorUserId: actor.id, actionType: 'payslip_delete', targetType: 'payslips', targetId: id,
    metadata: { user_id: existing.user_id, pay_month: existing.pay_month },
  });
  return NextResponse.json({ ok: true });
}
