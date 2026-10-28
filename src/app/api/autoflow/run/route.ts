import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { runAutoflow } from '@/lib/autoflow/run';

// POST /api/autoflow/run { dry?: boolean } - show what would be sent today (dry), or send it now.
// Anything already sent is skipped, so pressing this twice does not send twice.
export async function POST(req: NextRequest) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const dry = (await req.json().catch(() => ({})))?.dry !== false; // sending needs an explicit { dry: false }
  const result = await runAutoflow({ dry });
  if (!dry) {
    await logAudit({ actorUserId: actor.id, actionType: 'autoflow_run', targetType: 'autoflow', metadata: { planned: result.planned, sent: result.sent, skipped: result.skipped, delivered: result.delivered } });
  }
  return NextResponse.json({
    dry, today: result.today, planned: result.planned, sent: result.sent, skipped: result.skipped, delivered: result.delivered,
    items: result.items.map(i => ({ rule: i.rule, stage: i.stage, user_id: i.user.id, user_name: i.user_name, title: i.title, text: i.text, already_sent: i.already_sent })),
  });
}
