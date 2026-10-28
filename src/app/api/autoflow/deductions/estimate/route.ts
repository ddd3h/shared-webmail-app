import { NextRequest, NextResponse } from 'next/server';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { estimateDeductions } from '@/lib/fixed-pay-server';
import { estimateSchema } from '@/lib/payroll/input';

// POST /api/autoflow/deductions/estimate { user_id, month, earnings_total?, nontaxable? } - work the deductions out without making a pay statement
export async function POST(req: NextRequest) {
  if (!(await financeActor())) return forbidden();
  const parsed = estimateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const result = await estimateDeductions(parsed.data.user_id, parsed.data.month, parsed.data);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}
