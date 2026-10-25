import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { decrypt, encrypt } from '@/lib/crypto';
import { getActor, isAdmin } from '@/lib/work-auth';
import { isValidAccountNumber, last4 } from '@/lib/payment';
import { serializeVendor } from '@/lib/payment-server';

// GET /api/payments/vendors - payees. Admins see full bank details, everyone else a masked account.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const admin = isAdmin(actor);
  const all = new URL(req.url).searchParams.get('all') === '1' && admin;
  const rows = await prisma.payment_vendors.findMany({ where: all ? {} : { is_active: true }, orderBy: [{ name: 'asc' }] });
  return NextResponse.json({ items: await Promise.all(rows.map(v => serializeVendor(v, admin))) });
}

const optional = (re: RegExp) => z.string().trim().regex(re).optional().or(z.literal('').transform(() => undefined));
const vendorSchema = z.object({
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
});

// POST /api/payments/vendors - register a payee. Anyone may; it counts as verified only when an admin registers it.
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = vendorSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;

  // Same account registered twice is the classic way a payee ends up paid twice. The cheap columns narrow
  // the candidates; the full number (decrypted) decides, so two accounts that merely share the last digits pass.
  const candidates = await prisma.payment_vendors.findMany({
    where: { bank_name: d.bank_name, branch_name: d.branch_name, account_type: d.account_type, account_last4: last4(d.account_number), account_holder: d.account_holder },
    select: { id: true, name: true, account_number_enc: true },
  });
  for (const c of candidates) {
    if ((await decrypt(c.account_number_enc).catch(() => '')) === d.account_number) {
      return NextResponse.json({ error: 'duplicate_vendor', vendor_id: c.id, name: c.name }, { status: 409 });
    }
  }

  const admin = isAdmin(actor);
  const row = await prisma.payment_vendors.create({
    data: {
      name: d.name, name_kana: d.name_kana || null, bank_name: d.bank_name, bank_code: d.bank_code ?? null,
      branch_name: d.branch_name, branch_code: d.branch_code ?? null, account_type: d.account_type,
      account_number_enc: await encrypt(d.account_number), account_last4: last4(d.account_number),
      account_holder: d.account_holder, notes: d.notes || null, created_by_id: actor.id,
      ...(admin ? { verified_at: new Date(), verified_by_id: actor.id } : {}),
    },
  });
  await logAudit({ actorUserId: actor.id, actionType: 'payment_vendor_create', targetType: 'payment_vendors', targetId: row.id, metadata: { name: d.name, verified: admin } });
  return NextResponse.json({ id: row.id, verified: admin }, { status: 201 });
}
