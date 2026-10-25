import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { isValidMonth, jstDateString, payslipTotals } from '@/lib/work';

// GET /api/transfers/payroll?month=YYYY-MM - the month's pay statements with the state of each person's receiving account
// (finance staff only). This is the list a 給与振込 file is made from.
export async function GET(req: NextRequest) {
  if (!(await financeActor())) return forbidden();
  const month = new URL(req.url).searchParams.get('month') || jstDateString(new Date()).slice(0, 7);
  if (!isValidMonth(month)) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const rows = await prisma.payslips.findMany({
    where: { pay_month: month }, orderBy: [{ created_at: 'asc' }],
    include: { items: true, user: { select: { id: true, name: true, bank_account: { select: { verified_at: true, account_last4: true, bank_name: true, branch_name: true, bank_code: true, branch_code: true } } } } },
  });
  return NextResponse.json({
    month,
    items: rows.map(p => {
      const acct = p.user.bank_account;
      return {
        id: p.id, user: { id: p.user.id, name: p.user.name }, title: p.title, status: p.status, pay_month: p.pay_month,
        net: payslipTotals(p.items).net, batch_id: p.batch_id,
        account: acct ? { registered: true, verified: !!acct.verified_at, bank_name: acct.bank_name, branch_name: acct.branch_name, bank_code: acct.bank_code, branch_code: acct.branch_code, last4: acct.account_last4 } : { registered: false, verified: false },
      };
    }),
  });
}
