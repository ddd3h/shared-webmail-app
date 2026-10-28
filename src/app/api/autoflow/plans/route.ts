import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { FIXED_PAY_TYPES, plansOverlap } from '@/lib/fixed-pay';
import { planSchema } from '@/lib/fixed-pay-input';
import type { WorkerType } from '@/lib/work';

// GET /api/autoflow/plans - the fixed monthly pay that is registered (経理・管理者)
export async function GET() {
  if (!(await financeActor())) return forbidden();
  const [plans, users] = await Promise.all([
    prisma.fixed_pay_plans.findMany({ orderBy: [{ active: 'desc' }, { created_at: 'asc' }], include: { user: { select: { id: true, name: true, worker_type: true } } } }),
    prisma.users.findMany({ where: { worker_type: { in: FIXED_PAY_TYPES }, locked_at: null }, select: { id: true, name: true, worker_type: true }, orderBy: { name: 'asc' } }),
  ]);
  return NextResponse.json({
    plans: plans.map(p => ({ id: p.id, user_id: p.user_id, user_name: p.user.name, worker_type: p.user.worker_type, label: p.label, amount: p.amount, starts_month: p.starts_month, ends_month: p.ends_month, active: p.active, note: p.note })),
    users,
  });
}

// POST /api/autoflow/plans - register a fixed monthly pay for an 役員 or 準業務委託
export async function POST(req: NextRequest) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const parsed = planSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const user = await prisma.users.findUnique({ where: { id: d.user_id }, select: { worker_type: true } });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!FIXED_PAY_TYPES.includes(user.worker_type as WorkerType)) return NextResponse.json({ error: 'type_not_allowed' }, { status: 400 });
  // 同じ人の期間が重なる計画があると、同じ月に二重に払うことになる
  const others = await prisma.fixed_pay_plans.findMany({ where: { user_id: d.user_id, active: true } });
  if ((d.active ?? true) && others.some(o => plansOverlap(o, { starts_month: d.starts_month, ends_month: d.ends_month ?? null }))) {
    return NextResponse.json({ error: 'overlap' }, { status: 409 });
  }
  const plan = await prisma.fixed_pay_plans.create({
    data: { user_id: d.user_id, label: d.label, amount: d.amount, starts_month: d.starts_month, ends_month: d.ends_month ?? null, active: d.active ?? true, note: d.note ?? null, created_by_id: actor.id },
  });
  await logAudit({ actorUserId: actor.id, actionType: 'fixed_pay_plan_create', targetType: 'fixed_pay_plan', targetId: plan.id, metadata: { user_id: d.user_id, label: d.label, amount: d.amount, starts_month: d.starts_month, ends_month: d.ends_month ?? null } });
  return NextResponse.json({ ok: true, id: plan.id }, { status: 201 });
}
