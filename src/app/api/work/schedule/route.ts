import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { closingDate, currentPeriod, describeSchedule, expenseDeadline, isValidSchedule, payDate, periodStart, reportDeadline } from '@/lib/pay-schedule';
import { loadSchedule } from '@/lib/pay-schedule-server';
import { isValidMonth, jstDateString } from '@/lib/work';

// GET /api/work/schedule?userId=&month= - the 締め日・振込日 that applies to me (or, for 経理担当・管理者, to `userId`), and this period's dates.
// `month` is the period ('YYYY-MM', named by its closing month); the default is the one open today.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const userId = sp.get('userId');
  if (userId && userId !== actor.id && !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const target = userId && userId !== actor.id ? await getActor(userId) : actor;
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const month = sp.get('month');
  if (month && !isValidMonth(month)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const s = await loadSchedule(target.worker_type);
  if (!isValidSchedule(s)) return NextResponse.json({ error: 'invalid_schedule' }, { status: 500 });
  const today = jstDateString(new Date());
  const period = month ?? currentPeriod(today, s);
  return NextResponse.json({
    worker_type: target.worker_type, ...s, summary: describeSchedule(s), today,
    period: { month: period, start: periodStart(period, s), closing_date: closingDate(period, s), report_deadline: reportDeadline(period, s), expense_deadline: expenseDeadline(period, s), pay_date: payDate(period, s) },
  });
}
