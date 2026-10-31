import { NextRequest, NextResponse } from 'next/server';
import { recentAuthOrResponse } from '@/lib/reauth';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { accountChangedSinceApproval } from '@/lib/payment-fp';
import { decrypt } from '@/lib/crypto';
import { getActor, isFinance } from '@/lib/work-auth';
import { jstDateString } from '@/lib/work';
import { ACCOUNT_TYPE_LABEL, toCsv, transferAmount, type AccountType } from '@/lib/payment';

// GET /api/payments/export?ids=a,b - CSV of the transfers to make (finance staff).
// Only approved requests whose payee account is verified are included; without `ids` that means all of them.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  { const stale = await recentAuthOrResponse(); if (stale) return stale; } // high-risk: a recent proof of who is asking (lib/reauth.ts)
  const idsParam = new URL(req.url).searchParams.get('ids');
  const ids = idsParam ? idsParam.split(',').filter(Boolean).slice(0, 500) : null;

  const all = await prisma.payment_requests.findMany({
    where: { status: 'approved', vendor: { verified_at: { not: null } }, ...(ids ? { id: { in: ids } } : {}) },
    include: { vendor: true, user: { select: { name: true } } },
    orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }],
  });
  const rows = all.filter(r => !accountChangedSinceApproval(r, r.vendor)); // not to details that changed after the approval
  const header = ['振込先銀行名', '銀行コード', '支店名', '支店コード', '預金種目', '口座番号', '口座名義', '振込金額', '支払期日', '取引先名', '件名', '請求書番号', '申請者'];
  const body = await Promise.all(rows.map(async r => [
    r.vendor.bank_name, r.vendor.bank_code, r.vendor.branch_name, r.vendor.branch_code,
    ACCOUNT_TYPE_LABEL[r.vendor.account_type as AccountType], await decrypt(r.vendor.account_number_enc).catch(() => ''),
    r.vendor.account_holder, transferAmount(r), r.due_date.toISOString().slice(0, 10), r.vendor.name, r.title, r.invoice_number, r.user.name,
  ]));
  await logAudit({
    actorUserId: actor.id, actionType: 'payment_export', targetType: 'payment_requests',
    metadata: { count: rows.length, total: rows.reduce((s, r) => s + transferAmount(r), 0) },
  });
  return new NextResponse(toCsv([header, ...body]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="transfers-${jstDateString(new Date()).replace(/-/g, '')}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
