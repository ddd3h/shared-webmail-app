import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isFinance } from '@/lib/work-auth';
import { mergeQuasiReports } from '@/lib/work-reports-server';

// POST /api/work/reports/merge { apply?: boolean } - 準業務委託の報告書は1期間（月）に1通。1期間に何通も出していた人の分を、1通にまとめる（経理担当・管理者）。
// apply を付けないときは、まとめる対象の一覧だけを返す（何も変えない）。
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const apply = body?.apply === true;
  const items = await mergeQuasiReports(apply, actor.id);
  return NextResponse.json({ applied: apply, items, merged_reports: items.reduce((s, i) => s + i.count, 0) });
}
