import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { decrypt, encrypt } from '@/lib/crypto';
import { getActor, isFinance } from '@/lib/work-auth';
import { isValidAccountNumber, last4 } from '@/lib/payment';

const optional = (re: RegExp) => z.string().trim().regex(re).optional().or(z.literal('').transform(() => undefined));
const schema = z.object({
  name: z.string().trim().min(1).max(100),
  name_kana: z.string().trim().max(100).nullable().optional(),
  bank_name: z.string().trim().min(1).max(60),
  bank_code: optional(/^\d{4}$/),
  branch_name: z.string().trim().min(1).max(60),
  branch_code: optional(/^\d{3}$/),
  account_type: z.enum(['ordinary', 'checking', 'savings']),
  account_number: z.string().trim().refine(isValidAccountNumber),
  account_holder: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
});

async function adminOnly() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  return actor && isFinance(actor) ? actor : null;
}

// PUT /api/payments/vendors/:id (admin only).
// Changing any bank detail clears the verification, so a swapped account can never ride on an old approval.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminOnly();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const v = await prisma.payment_vendors.findUnique({ where: { id } });
  if (!v) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const oldNumber = await decrypt(v.account_number_enc).catch(() => '');
  const bankChanged =
    v.bank_name !== d.bank_name || (v.bank_code ?? '') !== (d.bank_code ?? '') || v.branch_name !== d.branch_name ||
    (v.branch_code ?? '') !== (d.branch_code ?? '') || v.account_type !== d.account_type ||
    v.account_holder !== d.account_holder || oldNumber !== d.account_number;

  await prisma.payment_vendors.update({
    where: { id },
    data: {
      name: d.name, name_kana: d.name_kana || null, bank_name: d.bank_name, bank_code: d.bank_code ?? null,
      branch_name: d.branch_name, branch_code: d.branch_code ?? null, account_type: d.account_type,
      ...(oldNumber !== d.account_number ? { account_number_enc: await encrypt(d.account_number), account_last4: last4(d.account_number) } : {}),
      account_holder: d.account_holder, notes: d.notes || null,
      ...(d.is_active !== undefined ? { is_active: d.is_active } : {}),
      ...(bankChanged ? { verified_at: null, verified_by_id: null } : {}),
    },
  });
  await logAudit({
    actorUserId: actor.id, actionType: bankChanged ? 'payment_vendor_bank_change' : 'payment_vendor_update', targetType: 'payment_vendors', targetId: id,
    metadata: { name: d.name, ...(bankChanged ? { old_last4: v.account_last4, new_last4: last4(d.account_number) } : {}) },
  });
  return NextResponse.json({ ok: true, verification_cleared: bankChanged && !!v.verified_at });
}

// DELETE /api/payments/vendors/:id - delete, or just switch off when requests already used it (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await adminOnly();
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await prisma.payment_vendors.findUnique({ where: { id } }))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const used = await prisma.payment_requests.count({ where: { vendor_id: id } });
  if (used > 0) await prisma.payment_vendors.update({ where: { id }, data: { is_active: false } });
  else await prisma.payment_vendors.delete({ where: { id } });
  await logAudit({ actorUserId: actor.id, actionType: 'payment_vendor_delete', targetType: 'payment_vendors', targetId: id, metadata: { deactivated: used > 0 } });
  return NextResponse.json({ ok: true, deactivated: used > 0 });
}
