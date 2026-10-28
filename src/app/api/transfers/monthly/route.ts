import { NextRequest, NextResponse } from 'next/server';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { isValidMonth, jstDateString } from '@/lib/work';
import { loadMonthlyItems } from '@/lib/transfer-monthly';

// GET /api/transfers/monthly?month=YYYY-MM - everything that has to be transferred by the end of the month, from every source (finance staff only).
// This is the list one monthly 全銀 file is made from.
export async function GET(req: NextRequest) {
  if (!(await financeActor())) return forbidden();
  const month = new URL(req.url).searchParams.get('month') || jstDateString(new Date()).slice(0, 7);
  if (!isValidMonth(month)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const items = await loadMonthlyItems(month);
  const total = (g: string) => items.filter(i => i.group === g).reduce((s, i) => s + i.amount, 0);
  return NextResponse.json({
    month, items,
    totals: { payroll: total('payroll'), payment: total('payment'), expense: total('expense'), all: items.reduce((s, i) => s + i.amount, 0) },
  });
}
