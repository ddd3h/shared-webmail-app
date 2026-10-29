import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { plansOverlap } from '@/lib/fixed-pay';
import { planSchema } from '@/lib/fixed-pay-input';

// PUT /api/autoflow/plans/:id - change a registered fixed pay. A pay statement that was already made keeps its amount.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const { id } = await params;
  const before = await prisma.fixed_pay_plans.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = planSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || parsed.data.user_id !== before.user_id) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const active = d.active ?? before.active;
  if (active) {
    const others = await prisma.fixed_pay_plans.findMany({ where: { user_id: before.user_id, active: true, NOT: { id } } });
    if (others.some(o => plansOverlap(o, { starts_month: d.starts_month, ends_month: d.ends_month ?? null }))) return NextResponse.json({ error: 'overlap' }, { status: 409 });
  }
  await prisma.fixed_pay_plans.update({ where: { id }, data: { label: d.label, amount: d.amount, commute_amount: d.commute_amount ?? 0, starts_month: d.starts_month, ends_month: d.ends_month ?? null, active, note: d.note ?? null } });
  await logAudit({ actorUserId: actor.id, actionType: 'fixed_pay_plan_update', targetType: 'fixed_pay_plan', targetId: id, metadata: { before: { label: before.label, amount: before.amount, commute_amount: before.commute_amount, starts_month: before.starts_month, ends_month: before.ends_month, active: before.active }, after: { label: d.label, amount: d.amount, commute_amount: d.commute_amount ?? 0, starts_month: d.starts_month, ends_month: d.ends_month ?? null, active } } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/autoflow/plans/:id - stop and remove a registered fixed pay. Pay statements already made are left as they are.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const { id } = await params;
  const plan = await prisma.fixed_pay_plans.findUnique({ where: { id } });
  if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.fixed_pay_plans.delete({ where: { id } });
  await logAudit({ actorUserId: actor.id, actionType: 'fixed_pay_plan_delete', targetType: 'fixed_pay_plan', targetId: id, metadata: { user_id: plan.user_id, label: plan.label, amount: plan.amount } });
  return NextResponse.json({ ok: true });
}
