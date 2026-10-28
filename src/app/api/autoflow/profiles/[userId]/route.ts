import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { DEDUCTION_TYPES } from '@/lib/fixed-pay';
import { profileSchema } from '@/lib/payroll/input';
import { toDbDate, type WorkerType } from '@/lib/work';

// PUT /api/autoflow/profiles/:userId - register (or change) what the automatic deductions need for one person
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const { userId } = await params;
  const parsed = profileSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { withholding_class, ...d } = parsed.data;
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { worker_type: true, locked_at: true } });
  if (!user || user.locked_at) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!DEDUCTION_TYPES.includes(user.worker_type as WorkerType)) return NextResponse.json({ error: 'type_not_allowed' }, { status: 400 });

  const data = { ...d, birth_date: d.birth_date ? toDbDate(d.birth_date) : null, updated_by_id: actor.id };
  const before = await prisma.payroll_profiles.findUnique({ where: { user_id: userId } });
  await prisma.payroll_profiles.upsert({ where: { user_id: userId }, create: { user_id: userId, ...data }, update: data });
  if (withholding_class) await prisma.users.update({ where: { id: userId }, data: { withholding_class } });
  // 生年月日は個人情報なので、監査ログには「どの項目を変えたか」だけを残す（値は残さない）
  const changed = !before ? ['created'] : (Object.keys(d) as (keyof typeof d)[]).filter(k => (k === 'birth_date' ? (before.birth_date ? before.birth_date.toISOString().slice(0, 10) : null) : before[k]) !== d[k]);
  await logAudit({ actorUserId: actor.id, actionType: 'payroll_profile_update', targetType: 'payroll_profile', targetId: userId, metadata: { user_id: userId, changed, ...(withholding_class ? { withholding_class } : {}) } });
  return NextResponse.json({ ok: true });
}
