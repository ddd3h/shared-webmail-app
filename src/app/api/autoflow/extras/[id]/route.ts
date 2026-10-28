import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { removeBonusSlip, syncAddons } from '@/lib/fixed-pay-server';

// DELETE /api/autoflow/extras/:id - take back an add-on or a bonus. A bonus that is already in a 全銀 file cannot be taken back here.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const { id } = await params;
  const extra = await prisma.pay_extras.findUnique({ where: { id } });
  if (!extra) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (extra.kind === 'bonus' && (await removeBonusSlip(id)) === 'locked') return NextResponse.json({ error: 'already_in_transfer' }, { status: 409 });
  await prisma.pay_extras.delete({ where: { id } });
  if (extra.kind === 'addon') await syncAddons(extra.user_id, extra.pay_month);
  await logAudit({ actorUserId: actor.id, actionType: 'pay_extra_delete', targetType: 'pay_extra', targetId: id, metadata: { user_id: extra.user_id, pay_month: extra.pay_month, kind: extra.kind, label: extra.label, amount: extra.amount } });
  return NextResponse.json({ ok: true });
}
