import { triggerFreeeSync } from '@/lib/freee-sync';
import { recentAuthOrResponse } from '@/lib/reauth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { selfDealing, selfDealingResponse } from '@/lib/finance-guard';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';
import { notifyExpenseReimbursed, notifyPayslip } from '@/lib/work-notify';
import { settleClaimsOfPayslip, syncExpenseItem } from '@/lib/expense-payslip';
import { isValidDateString, isValidMonth, jstDateString, payslipTotals, toDbDate } from '@/lib/work';

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
  })).max(50),
});

// A statement inside a 全銀 file that has not been recorded yet must not change: the file already says how much to pay.
const lockedByTransfer = (p: { status: string; batch_id: string | null }) => p.status === 'planned' && !!p.batch_id;
const LOCKED = { error: 'in_transfer_batch', message: '全銀データに含まれているため変更できません。先にデータを取り消してください' };

async function adminOnly() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  return actor && isFinance(actor) ? actor : null;
}

// PUT /api/work/payslips/:id - replace a statement (admin only)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminOnly();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  { const stale = await recentAuthOrResponse(); if (stale) return stale; } // high-risk: a recent proof of who is asking (lib/reauth.ts)
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const existing = await prisma.payslips.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (await selfDealing(actor.id, existing.user_id)) return selfDealingResponse();
  if (lockedByTransfer(existing)) return NextResponse.json(LOCKED, { status: 409 });

  // Items sent by the client never include the system 立替金精算 line; it is rebuilt from the attached claims.
  const attachedCount = await prisma.expense_claims.count({ where: { payslip_id: id } });
  if (d.items.length === 0 && attachedCount === 0) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  // Marking a statement paid without a date records today as the payment date.
  const payDate = d.pay_date || (existing.status !== 'paid' && d.status === 'paid' ? jstDateString(new Date()) : null);

  const settled = await prisma.$transaction(async tx => {
    await tx.payslip_items.deleteMany({ where: { payslip_id: id } });
    const updated = await tx.payslips.update({
      where: { id },
      data: {
        pay_month: d.pay_month, title: d.title, status: d.status,
        pay_date: payDate ? toDbDate(payDate) : null, note: d.note || null,
        // オートフローが作った明細を直した印。これ以後、加算の追加で行を作り直さない（直した内容が消えるため）
        ...(existing.auto_key ? { auto_edited: true } : {}),
        items: { create: d.items.map((i, idx) => ({ ...i, sort: idx })) },
      },
    });
    await syncExpenseItem(tx, id);
    // Paying the statement pays back the expenses merged into it.
    return existing.status !== 'paid' && d.status === 'paid'
      ? settleClaimsOfPayslip(tx, updated, actor.id)
      : { ids: [] as string[], date: '' };
  });
  if (settled.ids.length > 0) void notifyExpenseReimbursed(settled.ids, settled.date, '給与明細に合算');
  await logAudit({
    actorUserId: actor.id, actionType: 'payslip_update', targetType: 'payslips', targetId: id,
    metadata: { user_id: existing.user_id, pay_month: d.pay_month, net: payslipTotals(d.items).net },
  });
  if (existing.status !== 'paid' && d.status === 'paid') { void notifyPayslip(id, 'paid'); triggerFreeeSync(); }
  return NextResponse.json({ ok: true });
}

// DELETE /api/work/payslips/:id (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminOnly();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  { const stale = await recentAuthOrResponse(); if (stale) return stale; } // high-risk: a recent proof of who is asking (lib/reauth.ts)
  const existing = await prisma.payslips.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (await selfDealing(actor.id, existing.user_id)) return selfDealingResponse();
  if (lockedByTransfer(existing)) return NextResponse.json(LOCKED, { status: 409 });
  await prisma.payslips.delete({ where: { id } });
  await logAudit({
    actorUserId: actor.id, actionType: 'payslip_delete', targetType: 'payslips', targetId: id,
    metadata: { user_id: existing.user_id, pay_month: existing.pay_month },
  });
  return NextResponse.json({ ok: true });
}
