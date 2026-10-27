import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isFinance } from '@/lib/work-auth';
import { isWorkerType, loadSchedule, saveSchedule } from '@/lib/pay-schedule-server';

const schema = z.object({
  closing_day: z.number().int().min(0).max(28),
  pay_month_offset: z.number().int().min(0).max(2),
  pay_day: z.number().int().min(0).max(28),
  pay_day_shift: z.enum(['before', 'after', 'none']),
  report_deadline_days: z.number().int().min(0).max(31),
  expense_deadline_days: z.number().int().min(0).max(31),
});

// PUT /api/work/schedules/:type - set 締め日・振込日 of one kind of worker (経理担当・管理者).
// Things already paid keep their dates; what is still open is worked out again from the new setting.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!isWorkerType(type)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const before = await loadSchedule(type);
  await saveSchedule(type, parsed.data, actor.id);
  await logAudit({ actorUserId: actor.id, actionType: 'pay_schedule_update', targetType: 'pay_schedules', targetId: type, metadata: { from: before, to: parsed.data } });
  return NextResponse.json({ ok: true });
}
