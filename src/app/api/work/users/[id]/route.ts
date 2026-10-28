import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin, isFinance } from '@/lib/work-auth';
import { WITHHOLDING_CLASSES, WORKER_TYPES, type WithholdingClass, type WorkerType } from '@/lib/work';

const schema = z.object({
  worker_type: z.enum(WORKER_TYPES as [WorkerType, ...WorkerType[]]).optional(),
  is_accounting: z.boolean().optional(),
  is_hr: z.boolean().optional(),
  withholding_class: z.enum(WITHHOLDING_CLASSES as unknown as [WithholdingClass, ...WithholdingClass[]]).optional(),
}).refine(v => v.worker_type !== undefined || v.is_accounting !== undefined || v.is_hr !== undefined || v.withholding_class !== undefined, { message: 'nothing_to_change' });

// PATCH /api/work/users/:id - set 役員 / 従業員 / 業務委託 and the 経理担当 / 人事担当 flags (admin only),
// and the 源泉徴収の欄 (甲 / 乙), which 経理担当 may also set: they are the ones who work out the pay
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { worker_type, is_accounting, is_hr, withholding_class } = parsed.data;
  // 経理担当 may only touch the 源泉徴収の欄; type and roles are for admins
  if (!isAdmin(actor) && (worker_type !== undefined || is_accounting !== undefined || is_hr !== undefined)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const target = await prisma.users.findUnique({ where: { id }, select: { id: true, worker_type: true, withholding_class: true } });
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.users.update({ where: { id }, data: { ...(worker_type ? { worker_type } : {}), ...(is_accounting !== undefined ? { is_accounting } : {}), ...(is_hr !== undefined ? { is_hr } : {}), ...(withholding_class ? { withholding_class } : {}) } });
  if (worker_type) {
    await logAudit({
      actorUserId: session.userId, actionType: 'worker_type_update', targetType: 'users', targetId: id,
      metadata: { from: target.worker_type, to: worker_type },
    });
  }
  if (is_accounting !== undefined) {
    await logAudit({ actorUserId: session.userId, actionType: 'accounting_role_update', targetType: 'users', targetId: id, metadata: { is_accounting } });
  }
  if (withholding_class && withholding_class !== target.withholding_class) {
    await logAudit({ actorUserId: session.userId, actionType: 'withholding_class_update', targetType: 'users', targetId: id, metadata: { from: target.withholding_class, to: withholding_class } });
  }
  if (is_hr !== undefined) {
    await logAudit({ actorUserId: session.userId, actionType: 'hr_role_update', targetType: 'users', targetId: id, metadata: { is_hr } });
  }
  return NextResponse.json({ ok: true });
}
