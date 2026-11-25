import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { generateFixedDrafts } from '@/lib/fixed-pay-server';
import { isValidDateString, isValidMonth, jstDateString } from '@/lib/work';

// POST /api/autoflow/fixed/generate { pay_date | month, dry? } - make the drafts from the registered fixed pay now.
// `pay_date` makes what is paid that day: each person's month comes from their kind of worker's 締め日・振込日
// (11/25: 役員 11月分 when paid the same month, 準業務委託 10月分 when paid the next month). `month` makes that month for everyone.
// A draft that already exists is left alone, so pressing this twice makes no second one.
export async function POST(req: NextRequest) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const body = await req.json().catch(() => ({}));
  const payDate = typeof body?.pay_date === 'string' ? body.pay_date : undefined;
  if (payDate !== undefined && !isValidDateString(payDate)) return NextResponse.json({ error: 'invalid_pay_date' }, { status: 400 });
  const month = payDate === undefined ? body?.month : undefined;
  if (payDate === undefined && (typeof month !== 'string' || !isValidMonth(month))) return NextResponse.json({ error: 'invalid_month' }, { status: 400 });
  const dry = body.dry === true;
  const drafts = await generateFixedDrafts({ today: jstDateString(new Date()), ...(payDate ? { payDate } : { month }), actorId: actor.id, dry });
  if (!dry) await logAudit({ actorUserId: actor.id, actionType: 'fixed_pay_generate', targetType: 'fixed_pay', metadata: { ...(payDate ? { pay_date: payDate } : { month }), created: drafts.filter(d => d.status === 'new').length, conflicts: drafts.filter(d => d.status === 'conflict').length } });
  return NextResponse.json({ dry, ...(payDate ? { pay_date: payDate } : { month }), drafts });
}
