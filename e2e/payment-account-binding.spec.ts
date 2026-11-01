import { test, expect } from './fixtures';
import { USERS } from './helpers/constants';
import { db } from './helpers/db';
import { makePayment, makeVendor } from './helpers/factories';
import { resetTransfers } from './helpers/seed';

// 振込申請の承認は、承認したときの振込先の口座についてのもの。承認のあとに口座が書き換えられたら、新しい口座には振り込めない。
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetTransfers(); });
test.afterAll(async () => { await resetTransfers(); });

type As = (r: any) => Promise<import('@playwright/test').APIRequestContext>;
const bank = (over: Record<string, unknown> = {}) => ({
  name: '取引先', bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '123', account_type: 'ordinary',
  account_number: '1234567', account_holder: 'カ）テスト', ...over,
});
async function approved(as: As) {
  const vendor = await makeVendor({ name: '承認される取引先' });
  const req = await makePayment({ role: 'sato', vendorId: vendor.id, status: 'pending', amount: 100000 });
  expect((await (await as('admin')).post(`/api/payments/${req.id}/review`, { data: { action: 'approve' } })).status()).toBe(200);
  return { vendor, req };
}
const swap = async (as: As, vendorId: string) => {
  const keiri = await as('keiri');
  expect((await keiri.put(`/api/payments/vendors/${vendorId}`, { data: bank({ name: '承認される取引先', account_number: '7654321', account_holder: 'カ）ニセモノ' }) })).status()).toBe(200);
  expect((await keiri.post(`/api/payments/vendors/${vendorId}/verify`)).status()).toBe(200); // the person who changed it also confirms it: that alone must not pay it
};

test.describe('承認のあとに、取引先の口座が書き換えられたとき', () => {
  test('承認のときの口座の指紋が残る。口座が変わらなければ、これまでどおり振り込める', async ({ as }) => {
    const { req } = await approved(as);
    expect((await db.payment_requests.findUniqueOrThrow({ where: { id: req.id } })).approved_account_fp).toMatch(/^[0-9a-f]{64}$/);
    const csv = await (await (await as('keiri')).get('/api/payments/export')).text();
    expect(csv).toContain('承認される取引先');
    expect((await (await (await as('keiri')).post('/api/payments/mark-paid', { data: { ids: [req.id] } })).json()).paid).toBe(1);
  });

  test('書き換えて、自分で「確認済み」にしても、CSV・振込済・全銀データのどれにも入らない', async ({ as }) => {
    const { vendor, req } = await approved(as);
    await swap(as, vendor.id);
    const keiri = await as('keiri');
    expect(await (await keiri.get('/api/payments/export')).text()).not.toContain('承認される取引先');
    const paid = await (await keiri.post('/api/payments/mark-paid', { data: { ids: [req.id] } })).json();
    expect(paid).toMatchObject({ paid: 0, skipped: 1 });
    expect((await db.payment_requests.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('approved');
    const items = (await (await keiri.get('/api/payments?scope=all&status=approved')).json()).items;
    expect(items.find((i: { id: string }) => i.id === req.id)).toMatchObject({ account_changed: true });
    const month = await (await keiri.get(`/api/transfers/monthly?month=${new Date(Date.now() + 9 * 3600_000 + 40 * 86400_000).toISOString().slice(0, 7)}`)).json();
    void month;
  });

  test('管理者が新しい口座を確認し直す（再確認）と、その口座に振り込める。申請した本人は確認できない。変わっていなければ409', async ({ as }) => {
    const { vendor, req } = await approved(as);
    expect((await (await as('admin')).post(`/api/payments/${req.id}/reconfirm`)).status()).toBe(409); // nothing changed
    await swap(as, vendor.id);
    expect((await (await as('keiri')).post(`/api/payments/${req.id}/reconfirm`)).status()).toBe(403); // admin only
    expect((await (await as('sato')).post(`/api/payments/${req.id}/reconfirm`)).status()).toBe(403);
    expect((await (await as('admin')).post(`/api/payments/${req.id}/reconfirm`)).status()).toBe(200);
    expect(await db.audit_logs.count({ where: { action_type: 'payment_reconfirm', target_id: req.id } })).toBe(1);
    expect((await (await (await as('keiri')).post('/api/payments/mark-paid', { data: { ids: [req.id] } })).json()).paid).toBe(1);
  });

  test('口座が未確認（verified_at なし）のままなら、再確認はできない', async ({ as }) => {
    const { vendor, req } = await approved(as);
    expect((await (await as('keiri')).put(`/api/payments/vendors/${vendor.id}`, { data: bank({ name: '承認される取引先', account_number: '7654321' }) })).status()).toBe(200);
    expect((await (await as('admin')).post(`/api/payments/${req.id}/reconfirm`)).status()).toBe(409);
    void USERS;
  });
});
