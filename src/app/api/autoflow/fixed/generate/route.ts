import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { generateFixedDrafts } from '@/lib/fixed-pay-server';
import { isValidMonth, jstDateString } from '@/lib/work';

// POST /api/autoflow/fixed/generate { month, dry? } - make the month's drafts from the registered fixed pay now.
// A draft that already exists is left alone, so pressing this twice makes no second one.
export async function POST(req: NextRequest) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const body = await req.json().catch(() => ({}));
  if (typeof body?.month !== 'string' || !isValidMonth(body.month)) return NextResponse.json({ error: 'invalid_month' }, { status: 400 });
  const dry = body.dry === true;
  const drafts = await generateFixedDrafts({ today: jstDateString(new Date()), month: body.month, actorId: actor.id, dry });
  if (!dry) await logAudit({ actorUserId: actor.id, actionType: 'fixed_pay_generate', targetType: 'fixed_pay', metadata: { month: body.month, created: drafts.filter(d => d.status === 'new').length, conflicts: drafts.filter(d => d.status === 'conflict').length } });
  return NextResponse.json({ dry, month: body.month, drafts });
}
