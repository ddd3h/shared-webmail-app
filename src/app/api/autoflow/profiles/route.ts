import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { DEDUCTION_TYPES } from '@/lib/fixed-pay';

// GET /api/autoflow/profiles - who gets deductions, and what is registered for each (経理・管理者). Holds birth dates: finance only.
export async function GET() {
  if (!(await financeActor())) return forbidden();
  const users = await prisma.users.findMany({
    where: { worker_type: { in: DEDUCTION_TYPES }, locked_at: null },
    select: { id: true, name: true, worker_type: true, withholding_class: true, payroll_profile: true, fixed_pay_plans: { where: { active: true }, select: { amount: true, commute_amount: true, starts_month: true, ends_month: true }, orderBy: { starts_month: 'desc' }, take: 1 } },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({
    people: users.map(u => ({
      id: u.id, name: u.name, worker_type: u.worker_type, withholding_class: u.withholding_class,
      plan: u.fixed_pay_plans[0] ?? null,
      profile: u.payroll_profile ? {
        birth_date: u.payroll_profile.birth_date ? u.payroll_profile.birth_date.toISOString().slice(0, 10) : null,
        health_insured: u.payroll_profile.health_insured, employment_insured: u.payroll_profile.employment_insured,
        standard_monthly: u.payroll_profile.standard_monthly, dependents: u.payroll_profile.dependents,
        resident_tax: u.payroll_profile.resident_tax, resident_tax_first: u.payroll_profile.resident_tax_first,
      } : null,
    })),
  });
}
