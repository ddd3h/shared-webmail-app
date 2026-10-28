import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { FIXED_PAY_TYPES } from '@/lib/fixed-pay';
import { extraSchema } from '@/lib/fixed-pay-input';
import { createBonusSlip, syncAddons } from '@/lib/fixed-pay-server';
import { isValidMonth, type WorkerType } from '@/lib/work';

// GET /api/autoflow/extras?month=YYYY-MM - one-time add-ons and bonuses of a month (経理・管理者)
export async function GET(req: NextRequest) {
  if (!(await financeActor())) return forbidden();
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!isValidMonth(month)) return NextResponse.json({ error: 'invalid_month' }, { status: 400 });
  const rows = await prisma.pay_extras.findMany({ where: { pay_month: month }, orderBy: { created_at: 'asc' }, include: { user: { select: { name: true } } } });
  return NextResponse.json({ extras: rows.map(r => ({ id: r.id, user_id: r.user_id, user_name: r.user.name, pay_month: r.pay_month, kind: r.kind, label: r.label, amount: r.amount })) });
}

// POST /api/autoflow/extras - add an add-on (goes onto that month's draft) or a bonus (becomes its own pay statement)
export async function POST(req: NextRequest) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const parsed = extraSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const user = await prisma.users.findUnique({ where: { id: d.user_id }, select: { worker_type: true, locked_at: true } });
  if (!user || user.locked_at) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // 加算は固定報酬の下書きに足すもの。賞与は役員・準業務委託以外（従業員など）にも出せる
  if (d.kind === 'addon' && !FIXED_PAY_TYPES.includes(user.worker_type as WorkerType)) return NextResponse.json({ error: 'type_not_allowed' }, { status: 400 });

  const extra = await prisma.pay_extras.create({ data: { ...d, created_by_id: actor.id } });
  if (d.kind === 'bonus') await createBonusSlip(extra, actor.id);
  else await syncAddons(d.user_id, d.pay_month);
  await logAudit({ actorUserId: actor.id, actionType: 'pay_extra_create', targetType: 'pay_extra', targetId: extra.id, metadata: { user_id: d.user_id, pay_month: d.pay_month, kind: d.kind, label: d.label, amount: d.amount } });
  return NextResponse.json({ ok: true, id: extra.id }, { status: 201 });
}
