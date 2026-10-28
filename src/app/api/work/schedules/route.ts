import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { currentPeriod, closingDate, describeSchedule, payDate, periodStart } from '@/lib/pay-schedule';
import { loadSchedules } from '@/lib/pay-schedule-server';
import { WORKER_TYPES, WORKER_TYPE_LABEL, jstDateString } from '@/lib/work';

// GET /api/work/schedules - 締め日・振込日 of every kind of worker, with this period's dates worked out as an example (経理担当・管理者)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { schedules, custom } = await loadSchedules();
  const today = jstDateString(new Date());
  return NextResponse.json({
    items: WORKER_TYPES.map(t => {
      const s = schedules[t];
      const period = currentPeriod(today, s);
      return { worker_type: t, label: WORKER_TYPE_LABEL[t], ...s, custom: custom.has(t), summary: describeSchedule(s), example: { period, start: periodStart(period, s), closing_date: closingDate(period, s), pay_date: payDate(period, s) } };
    }),
  });
}
