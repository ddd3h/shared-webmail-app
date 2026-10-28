import type { APIRequestContext } from '@playwright/test';
import { encrypt } from '../../src/lib/crypto';
import { db } from './db';
import { USERS, type Role } from './constants';

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
let n = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}`;

// ---- tiny upload fixtures ----
export const PDF = { name: 'receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') };
export const PNG = {
  name: 'receipt.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
};
export const HTML_FILE = { name: 'evil.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') };
export const SVG_FILE = { name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') };

// ---- expense claims ----
export async function makeClaim(o: {
  role?: Role; title?: string; amount?: number; status?: 'pending' | 'approved' | 'rejected' | 'paid'; method?: 'personal' | 'company';
  date?: string; category?: string; comment?: string; tripId?: string; payslipId?: string;
}) {
  const user = USERS[o.role ?? 'sato'];
  return db.expense_claims.create({
    data: {
      id: id('c'), user_id: user.id, expense_date: d(o.date ?? new Date().toISOString().slice(0, 10)), category: o.category ?? '交通費',
      title: o.title ?? `経費-${n}`, amount: o.amount ?? 1000, payment_method: o.method ?? 'personal', status: o.status ?? 'pending',
      ...(o.status && o.status !== 'pending' ? { reviewed_by_id: USERS.admin.id, reviewed_at: new Date(), review_comment: o.comment ?? null } : {}),
      ...(o.status === 'paid' ? { reimbursed_at: new Date(), reimbursed_by_id: USERS.admin.id } : {}),
      trip_id: o.tripId ?? null, payslip_id: o.payslipId ?? null,
    },
  });
}

export async function postClaim(c: APIRequestContext, o: Record<string, string> = {}, files: { name: string; mimeType: string; buffer: Buffer }[] = []) {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    expense_date: new Date().toISOString().slice(0, 10), category: '交通費', title: `申請-${id('t')}`, amount: '1200', payment_method: 'personal', ...o,
  };
  if (files.length === 1) multipart.file = files[0];
  if (files.length > 1) {
    // Playwright's multipart option takes one value per key; repeat the field through a raw body for several files
    const boundary = '----e2e' + Date.now();
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(multipart)) {
      if (typeof v === 'string') parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    for (const f of files) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: ${f.mimeType}\r\n\r\n`), f.buffer, Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return c.post('/api/expenses', { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, data: Buffer.concat(parts) });
  }
  return c.post('/api/expenses', { multipart });
}

// ---- pay statements ----
export async function makePayslip(o: { role?: Role; month?: string; title?: string; status?: 'planned' | 'paid'; items?: { kind: 'earning' | 'deduction'; label: string; amount: number }[]; payDate?: string }) {
  const user = USERS[o.role ?? 'sato'];
  return db.payslips.create({
    data: {
      id: id('p'), user_id: user.id, pay_month: o.month ?? new Date().toISOString().slice(0, 7), title: o.title ?? '給与', status: o.status ?? 'planned',
      pay_date: o.payDate ? d(o.payDate) : null,
      items: { create: (o.items ?? [{ kind: 'earning', label: '基本給', amount: 300000 }]).map((i, sort) => ({ ...i, sort })) },
    },
    include: { items: true },
  });
}

// ---- trips ----
export async function makeTrip(o: { role?: Role; destination?: string; start?: string; end?: string; status?: 'pending' | 'approved' | 'rejected' | 'cancelled'; comment?: string }) {
  const user = USERS[o.role ?? 'sato'];
  const today = new Date().toISOString().slice(0, 10);
  return db.business_trips.create({
    data: {
      id: id('t'), user_id: user.id, destination: o.destination ?? '名古屋', purpose: 'A社 システム導入', start_date: d(o.start ?? today), end_date: d(o.end ?? o.start ?? today),
      status: o.status ?? 'approved', ...(o.status && o.status !== 'pending' ? { reviewed_by_id: USERS.admin.id, reviewed_at: new Date(), review_comment: o.comment ?? null } : {}),
    },
  });
}

// ---- payment vendors / requests ----
export async function makeVendor(o: { name?: string; verified?: boolean; accountNumber?: string; active?: boolean; bank?: string } = {}) {
  const num = o.accountNumber ?? String(1000000 + Math.floor(Math.random() * 8999999));
  return db.payment_vendors.create({
    data: {
      id: id('v'), name: o.name ?? `取引先-${n}`, bank_name: o.bank ?? 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '123',
      account_type: 'ordinary', account_number_enc: await encrypt(num), account_last4: num.slice(-4), account_holder: 'カ）テスト',
      is_active: o.active ?? true, ...(o.verified === false ? {} : { verified_at: new Date(), verified_by_id: USERS.admin.id }), created_by_id: USERS.admin.id,
    },
  });
}

export async function makePayment(o: {
  role?: Role; vendorId: string; status?: 'pending' | 'approved' | 'rejected' | 'paid'; amount?: number; deduction?: number; fee?: number; bearer?: 'us' | 'vendor';
  due?: string; invoice?: string | null; title?: string; comment?: string;
}) {
  const user = USERS[o.role ?? 'sato'];
  return db.payment_requests.create({
    data: {
      id: id('r'), user_id: user.id, vendor_id: o.vendorId, title: o.title ?? `振込-${n}`, amount: o.amount ?? 110000, deduction_amount: o.deduction ?? 0,
      fee: o.fee ?? 0, fee_bearer: o.bearer ?? 'us', invoice_number: o.invoice ?? null,
      due_date: d(o.due ?? new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)), status: o.status ?? 'pending',
      ...(o.status && o.status !== 'pending' ? { reviewed_by_id: USERS.admin.id, reviewed_at: new Date(), review_comment: o.comment ?? null } : {}),
      ...(o.status === 'paid' ? { paid_at: new Date(), paid_by_id: USERS.admin.id } : {}),
    },
  });
}

// ---- receiving accounts ----
// Finance confirms the exact version of an account they looked at, so the helper reads the current revision first.
export async function verifyBankAccount(finance: APIRequestContext, userId: string) {
  const list = (await (await finance.get('/api/bank-accounts')).json()).items as { user: { id: string }; account: { revision: string } | null }[];
  const revision = list.find(i => i.user.id === userId)?.account?.revision ?? 'none';
  return finance.post(`/api/bank-accounts/${userId}/verify`, { data: { revision } });
}
