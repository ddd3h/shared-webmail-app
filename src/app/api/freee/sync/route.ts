import { NextResponse } from 'next/server';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';
import { syncToFreee } from '@/lib/freee-sync';

// POST /api/freee/sync - send everything that has been paid and not sent yet (and retry the ones that failed) (経理担当・管理者)
export async function POST() {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const r = await syncToFreee();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  await logAudit({ actorUserId: actor.id, actionType: 'freee_sync', targetType: 'freee_exports', metadata: { sent: r.sent, failed: r.failed, skipped: r.skipped } });
  return NextResponse.json(r);
}
