import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';

const schema = z.object({
  worker_type: z.enum(['executive', 'employee', 'contractor']).optional(),
  is_accounting: z.boolean().optional(),
}).refine(v => v.worker_type !== undefined || v.is_accounting !== undefined, { message: 'nothing_to_change' });

// PATCH /api/work/users/:id - set 役員 / 従業員 / 業務委託 and the 経理担当 flag (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const target = await prisma.users.findUnique({ where: { id }, select: { id: true, worker_type: true } });
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { worker_type, is_accounting } = parsed.data;
  await prisma.users.update({ where: { id }, data: { ...(worker_type ? { worker_type } : {}), ...(is_accounting !== undefined ? { is_accounting } : {}) } });
  if (worker_type) {
    await logAudit({
      actorUserId: session.userId, actionType: 'worker_type_update', targetType: 'users', targetId: id,
      metadata: { from: target.worker_type, to: worker_type },
    });
  }
  if (is_accounting !== undefined) {
    await logAudit({ actorUserId: session.userId, actionType: 'accounting_role_update', targetType: 'users', targetId: id, metadata: { is_accounting } });
  }
  return NextResponse.json({ ok: true });
}
