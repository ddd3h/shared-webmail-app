import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { recalcDeductions } from '@/lib/fixed-pay-server';

// POST /api/autoflow/deductions/recalc { payslip_id } - work the automatic deductions of a draft out again
export async function POST(req: NextRequest) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const body = await req.json().catch(() => ({}));
  if (typeof body?.payslip_id !== 'string' || !body.payslip_id) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const r = await recalcDeductions(body.payslip_id);
  if (r.status === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (r.status !== 'done') return NextResponse.json({ error: r.status }, { status: r.status === 'locked' ? 409 : 400 });
  await logAudit({ actorUserId: actor.id, actionType: 'payslip_deductions_recalc', targetType: 'payslips', targetId: body.payslip_id, metadata: { deductions: r.deductions, warnings: r.warnings.length } });
  return NextResponse.json({ ok: true, deductions: r.deductions, warnings: r.warnings });
}
