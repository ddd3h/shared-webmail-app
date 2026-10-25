import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    payment_vendors: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    payment_requests: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    users: { count: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u1' })), requireAuth: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/crypto', () => ({ encrypt: vi.fn(async (s: string) => `enc:${s}`), decrypt: vi.fn(async (s: string) => s.replace(/^enc:/, '')) }));
vi.mock('@/lib/attachment-storage', () => ({ saveUploadedFiles: vi.fn(async () => []), deleteStoredFiles: vi.fn() }));
vi.mock('@/lib/work-auth', () => ({ getActor: vi.fn(), isAdmin: (a: any) => a.role === 'admin' }));
vi.mock('@/lib/work-notify', () => ({ notifyPaymentSubmitted: vi.fn(), notifyPaymentReviewed: vi.fn(), notifyPaymentPaid: vi.fn() }));

import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getActor } from '@/lib/work-auth';
import { notifyPaymentPaid, notifyPaymentReviewed, notifyPaymentSubmitted } from '@/lib/work-notify';
import { GET as listVendors, POST as addVendor } from '@/app/api/payments/vendors/route';
import { PUT as putVendor, DELETE as delVendor } from '@/app/api/payments/vendors/[id]/route';
import { POST as verifyVendor } from '@/app/api/payments/vendors/[id]/verify/route';
import { PATCH as patchRequest } from '@/app/api/payments/[id]/route';
import { POST as review } from '@/app/api/payments/[id]/review/route';
import { POST as markPaid } from '@/app/api/payments/mark-paid/route';
import { GET as exportCsv } from '@/app/api/payments/export/route';
import { GET as listRequests } from '@/app/api/payments/route';

const actor = (role = 'user') => ({ id: 'u1', name: '田中', role, worker_type: 'employee' });
const json = (b: object, method = 'POST') => new Request('http://x', { method, body: JSON.stringify(b) }) as any;
const ctx = { params: Promise.resolve({ id: 'p1' }) };
const vendorRow = (o: object = {}) => ({
  id: 'v1', name: 'A社', name_kana: null, bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '123',
  account_type: 'ordinary', account_number_enc: 'enc:1234567', account_last4: '4567', account_holder: 'エーシヤ', notes: null,
  is_active: true, verified_at: new Date(), ...o,
});
const vendorBody = (o: object = {}) => ({ name: 'A社', bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '123', account_type: 'ordinary', account_number: '1234567', account_holder: 'エーシヤ', ...o });
const req = (o: object = {}) => ({ id: 'p1', user_id: 'u2', vendor_id: 'v1', status: 'pending', amount: 110000, deduction_amount: 0, fee: 0, fee_bearer: 'us', vendor: { verified_at: new Date(), is_active: true }, ...o });
const patchBody = (o: object = {}) => ({ vendor_id: 'v1', title: '10月分外注費', amount: 110000, due_date: '2026-10-31', ...o });

beforeEach(() => {
  vi.resetAllMocks();
  (getActor as any).mockResolvedValue(actor());
});

describe('取引先の表示', () => {
  it('一般ユーザーには口座番号を見せず、末尾だけ表示する', async () => {
    (prisma.payment_vendors.findMany as any).mockResolvedValue([vendorRow()]);
    const body = await (await listVendors(new Request('http://x/api/payments/vendors') as any)).json();
    expect(body.items[0].account_masked).toBe('●●●4567');
    expect(JSON.stringify(body)).not.toContain('1234567');
    expect(body.items[0]).not.toHaveProperty('account_holder');
  });
  it('管理者には全口座情報を見せる', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_vendors.findMany as any).mockResolvedValue([vendorRow()]);
    const body = await (await listVendors(new Request('http://x/api/payments/vendors') as any)).json();
    expect(body.items[0]).toMatchObject({ account_number: '1234567', account_holder: 'エーシヤ', bank_code: '0001' });
  });
});

describe('取引先の登録・変更', () => {
  it('一般ユーザーの登録は未確認で、口座番号は暗号化して保存する', async () => {
    (prisma.payment_vendors.findMany as any).mockResolvedValue([]);
    (prisma.payment_vendors.create as any).mockResolvedValue({ id: 'v9' });
    const res = await addVendor(json(vendorBody()));
    expect(res.status).toBe(201);
    expect((await res.json()).verified).toBe(false);
    const data = (prisma.payment_vendors.create as any).mock.calls[0][0].data;
    expect(data.account_number_enc).toBe('enc:1234567');
    expect(data.account_last4).toBe('4567');
    expect(data).not.toHaveProperty('verified_at');
  });
  it('管理者の登録は確認済になる', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_vendors.findMany as any).mockResolvedValue([]);
    (prisma.payment_vendors.create as any).mockResolvedValue({ id: 'v9' });
    await addVendor(json(vendorBody()));
    expect((prisma.payment_vendors.create as any).mock.calls[0][0].data.verified_at).toBeInstanceOf(Date);
  });
  it('同じ口座の二重登録は409', async () => {
    (prisma.payment_vendors.findMany as any).mockResolvedValue([{ id: 'v1', name: 'A社', account_number_enc: 'enc:1234567' }]);
    expect((await addVendor(json(vendorBody()))).status).toBe(409);
    expect(prisma.payment_vendors.create).not.toHaveBeenCalled();
  });
  it('末尾4桁が同じだけの別口座は重複ではない', async () => {
    (prisma.payment_vendors.findMany as any).mockResolvedValue([{ id: 'v1', name: 'A社', account_number_enc: 'enc:9994567' }]);
    (prisma.payment_vendors.create as any).mockResolvedValue({ id: 'v9' });
    expect((await addVendor(json(vendorBody()))).status).toBe(201);
  });
  it('口座番号の形式が不正なら400', async () => {
    expect((await addVendor(json(vendorBody({ account_number: '12-34' })))).status).toBe(400);
  });
  it('一般ユーザーは変更・確認・削除できない', async () => {
    expect((await putVendor(json(vendorBody(), 'PUT'), ctx)).status).toBe(403);
    expect((await verifyVendor(json({}), ctx)).status).toBe(403);
    expect((await delVendor(json({}, 'DELETE'), ctx)).status).toBe(403);
  });
  it('口座情報を変えると確認済が外れ、名称だけなら外れない', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_vendors.findUnique as any).mockResolvedValue(vendorRow());
    await putVendor(json(vendorBody({ account_number: '7654321' }), 'PUT'), ctx);
    expect((prisma.payment_vendors.update as any).mock.calls[0][0].data).toMatchObject({ verified_at: null, account_number_enc: 'enc:7654321', account_last4: '4321' });
    expect((logAudit as any).mock.calls[0][0].actionType).toBe('payment_vendor_bank_change');
    await putVendor(json(vendorBody({ name: 'A株式会社' }), 'PUT'), ctx);
    const data = (prisma.payment_vendors.update as any).mock.calls[1][0].data;
    expect(data.name).toBe('A株式会社');
    expect(data).not.toHaveProperty('verified_at');
    expect(data).not.toHaveProperty('account_number_enc');
  });
  it('使用済みの取引先は削除せず無効にする', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_vendors.findUnique as any).mockResolvedValue(vendorRow());
    (prisma.payment_requests.count as any).mockResolvedValue(2);
    expect((await (await delVendor(json({}, 'DELETE'), ctx)).json()).deactivated).toBe(true);
    expect(prisma.payment_vendors.delete).not.toHaveBeenCalled();
  });
});

describe('振込申請の一覧', () => {
  it('一般ユーザーは全員分を見られない', async () => {
    expect((await listRequests(new Request('http://x/api/payments?scope=all') as any)).status).toBe(403);
  });
});

describe('振込申請の編集', () => {
  const patch = (b: object) => patchRequest(json(b, 'PATCH'), ctx);
  it('他人の申請は編集できない', async () => {
    (prisma.payment_requests.findUnique as any).mockResolvedValue(req({ user_id: 'u2' }));
    expect((await patch(patchBody())).status).toBe(403);
  });
  it('承認済み・振込済みは編集できない', async () => {
    for (const status of ['approved', 'paid']) {
      (prisma.payment_requests.findUnique as any).mockResolvedValue(req({ user_id: 'u1', status }));
      expect((await patch(patchBody())).status).toBe(409);
    }
  });
  it('控除が請求額を超えると400', async () => {
    (prisma.payment_requests.findUnique as any).mockResolvedValue(req({ user_id: 'u1' }));
    expect((await patch(patchBody({ deduction_amount: 200000 }))).status).toBe(400);
  });
  it('請求書番号が重複すると409', async () => {
    (prisma.payment_requests.findUnique as any).mockResolvedValue(req({ user_id: 'u1' }));
    (prisma.payment_vendors.findUnique as any).mockResolvedValue({ is_active: true });
    (prisma.payment_requests.findFirst as any).mockResolvedValue({ id: 'other' });
    expect((await patch(patchBody({ invoice_number: 'INV-001' }))).status).toBe(409);
  });
  it('却下された申請を直すと承認待ちに戻り、管理者に再申請が通知される', async () => {
    (prisma.payment_requests.findUnique as any).mockResolvedValue(req({ user_id: 'u1', status: 'rejected' }));
    (prisma.payment_vendors.findUnique as any).mockResolvedValue({ is_active: true });
    (prisma.payment_requests.findFirst as any).mockResolvedValue(null);
    expect((await patch(patchBody({ invoice_number: 'INV-002' }))).status).toBe(200);
    expect((prisma.payment_requests.update as any).mock.calls[0][0].data).toMatchObject({ status: 'pending', review_comment: null });
    expect(notifyPaymentSubmitted).toHaveBeenCalledWith('p1', true);
  });
});

describe('承認', () => {
  const act = (b: object) => review(json(b), ctx);
  it('管理者以外は承認できない', async () => {
    expect((await act({ action: 'approve' })).status).toBe(403);
  });
  it('口座が未確認の取引先宛は承認できない', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_requests.findUnique as any).mockResolvedValue(req({ vendor: { verified_at: null, is_active: true } }));
    const res = await act({ action: 'approve' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('vendor_unverified');
    expect(prisma.payment_requests.updateMany).not.toHaveBeenCalled();
  });
  it('未確認でも却下はできる（理由必須）', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    expect((await act({ action: 'reject' })).status).toBe(400);
    (prisma.payment_requests.findUnique as any).mockResolvedValue(req({ vendor: { verified_at: null, is_active: true } }));
    (prisma.users.count as any).mockResolvedValue(2);
    (prisma.payment_requests.updateMany as any).mockResolvedValue({ count: 1 });
    expect((await act({ action: 'reject', comment: '口座を確認してください' })).status).toBe(200);
  });
  it('管理者が複数いるとき自分の申請は承認できない', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_requests.findUnique as any).mockResolvedValue(req({ user_id: 'u1' }));
    (prisma.users.count as any).mockResolvedValue(2);
    expect((await act({ action: 'approve' })).status).toBe(403);
  });
  it('他人の申請を承認して通知する', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_requests.findUnique as any).mockResolvedValue(req());
    (prisma.users.count as any).mockResolvedValue(2);
    (prisma.payment_requests.updateMany as any).mockResolvedValue({ count: 1 });
    expect((await act({ action: 'approve' })).status).toBe(200);
    expect(notifyPaymentReviewed).toHaveBeenCalledWith('p1', 'approve');
  });
});

describe('振込済の記録', () => {
  it('管理者以外はできない', async () => {
    expect((await markPaid(json({ ids: ['p1'] }))).status).toBe(403);
  });
  it('承認済みで口座が確認済のものだけ振込済にし、それ以外はスキップと返す', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_requests.findMany as any).mockResolvedValue([{ id: 'p1', amount: 1000, deduction_amount: 0, fee: 0, fee_bearer: 'us' }]);
    (prisma.payment_requests.updateMany as any).mockResolvedValue({ count: 1 });
    const res = await markPaid(json({ ids: ['p1', 'p2'], paid_date: '2026-10-31' }));
    expect(await res.json()).toEqual({ paid: 1, skipped: 1 });
    expect((prisma.payment_requests.findMany as any).mock.calls[0][0].where).toMatchObject({ status: 'approved', vendor: { verified_at: { not: null } } });
    expect(notifyPaymentPaid).toHaveBeenCalledWith(['p1'], '2026-10-31');
  });
});

describe('CSV出力', () => {
  it('管理者以外はできない', async () => {
    expect((await exportCsv(new Request('http://x/api/payments/export') as any)).status).toBe(403);
  });
  it('振込先・金額をCSVにし、数式の先頭文字は無効化、出力を監査ログに残す', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.payment_requests.findMany as any).mockResolvedValue([{
      id: 'p1', title: '=SUM(A1)', amount: 110000, deduction_amount: 11226, fee: 0, fee_bearer: 'us', invoice_number: 'INV-1',
      due_date: new Date('2026-10-31T00:00:00Z'), vendor: vendorRow(), user: { name: '佐藤' },
    }]);
    const res = await exportCsv(new Request('http://x/api/payments/export') as any);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    const text = await res.text();
    expect(text).toContain('みずほ銀行,0001,新宿支店,123,普通,1234567,エーシヤ,98774,2026-10-31,A社');
    expect(text).toContain("'=SUM(A1)");
    expect((prisma.payment_requests.findMany as any).mock.calls[0][0].where).toMatchObject({ status: 'approved', vendor: { verified_at: { not: null } } });
    expect((logAudit as any).mock.calls[0][0]).toMatchObject({ actionType: 'payment_export', metadata: { count: 1, total: 98774 } });
  });
});
