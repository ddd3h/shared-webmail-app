import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin } from '@/lib/work-auth';

const schema = z.object({ worker_type: z.enum(['executive', 'employee', 'contractor']) });

// PATCH /api/work/users/:id - set 役員 / 従業員 / 業務委託 (admin only)
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
  await prisma.users.update({ where: { id }, data: { worker_type: parsed.data.worker_type } });
  await logAudit({
    actorUserId: session.userId, actionType: 'worker_type_update', targetType: 'users', targetId: id,
    metadata: { from: target.worker_type, to: parsed.data.worker_type },
  });
  return NextResponse.json({ ok: true });
}
