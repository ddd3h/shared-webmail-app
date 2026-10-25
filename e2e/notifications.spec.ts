import { test, expect } from './fixtures';
import { USERS } from './helpers/constants';
import { db } from './helpers/db';
import { jstDate, resetTransfers, clearNotifications } from './helpers/seed';
import { makeClaim, makePayment, makePayslip, makeVendor, postClaim, verifyBankAccount } from './helpers/factories';
import { mm } from './helpers/mattermost-mock';

// The mock Mattermost lives in the global-setup process; DMs are addressed by "mm-<local part of the email>".
const to = (role: keyof typeof USERS) => `mm-${USERS[role].email.split('@')[0]}`;
const recipients = (posts: { to: string }[]) => posts.map(p => p.to).sort();

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetTransfers(); await clearNotifications(); await mm.reset(); });
test.afterAll(async () => { await mm.reset(); });

const ACCOUNT = { bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '234', account_type: 'ordinary', account_number: '1234567', account_holder: 'サトウ タロウ' };

test.describe('Mattermost通知', () => {
  test('経費の申請 → 申請者以外の管理者に届く（本人には届かない）', async ({ as }) => {
    const res = await postClaim(await as('sato'), { title: '通知テストの交通費', amount: '3300' });
    expect(res.status()).toBe(201);
    const posts = await mm.waitFor(p => p.message.includes('通知テストの交通費'));
    expect(recipients(posts)).toEqual([to('admin'), to('admin2')]);
    expect(posts[0].message).toContain('¥3,300');
  });

  test('管理者が申請した場合は、他の管理者にだけ届く', async ({ as }) => {
    await postClaim(await as('admin'), { title: '管理者の立替' });
    const posts = await mm.waitFor(p => p.message.includes('管理者の立替'));
    expect(recipients(posts)).toEqual([to('admin2')]);
  });

  test('経費の承認・却下 → 申請者に届く。却下の理由も載る', async ({ as }) => {
    const c1 = await makeClaim({ role: 'sato', title: '承認される経費' });
    const c2 = await makeClaim({ role: 'sato', title: '却下される経費' });
    const admin = await as('admin');
    expect((await admin.post(`/api/expenses/${c1.id}/review`, { data: { action: 'approve' } })).status()).toBe(200);
    expect((await admin.post(`/api/expenses/${c2.id}/review`, { data: { action: 'reject', comment: '領収書が不鮮明です' } })).status()).toBe(200);
    const ok = await mm.waitFor(p => p.message.includes('承認される経費'));
    const ng = await mm.waitFor(p => p.message.includes('却下される経費'));
    expect(recipients(ok)).toEqual([to('sato')]);
    expect(ng[0].message).toContain('領収書が不鮮明です');
  });

  test('振込申請 → 管理者へ、承認 → 申請者へ、振込済 → 申請者へ。DMに口座番号は載らない', async ({ as }) => {
    const v = await makeVendor({ accountNumber: '9988776' });
    const form = { vendor_id: v.id, title: '通知テストの外注費', amount: '110000', due_date: jstDate(7) };
    const res = await (await as('sato')).post('/api/payments', { multipart: form });
    expect(res.status()).toBe(201);
    const id = (await res.json()).id;
    const submitted = await mm.waitFor(p => p.message.includes('通知テストの外注費'));
    expect(recipients(submitted)).toEqual([to('admin'), to('admin2')]);

    await mm.reset();
    await (await as('admin')).post(`/api/payments/${id}/review`, { data: { action: 'approve' } });
    expect(recipients(await mm.waitFor(p => p.message.includes('承認されました')))).toEqual([to('sato')]);

    await mm.reset();
    await (await as('keiri')).post('/api/payments/mark-paid', { data: { ids: [id] } });
    const paid = await mm.waitFor(p => p.message.includes('振込が完了しました'));
    expect(recipients(paid)).toEqual([to('sato')]);
    for (const p of [...submitted, ...paid]) expect(p.message).not.toContain('9988776');
  });

  test('受取口座の登録 → 管理者と経理担当に届く（口座番号は載らない）。確認 → 本人に届く', async ({ as }) => {
    await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
    const posts = await mm.waitFor(p => p.message.includes('受取口座が登録・変更されました'));
    expect(recipients(posts)).toEqual([to('admin'), to('admin2'), to('keiri')]);
    for (const p of posts) { expect(p.message).not.toContain('1234567'); expect(p.message).not.toContain('サトウ'); }

    await mm.reset();
    await verifyBankAccount(await as('keiri'), USERS.sato.id);
    const verified = await mm.waitFor(p => p.message.includes('受取口座が確認されました'));
    expect(recipients(verified)).toEqual([to('sato')]);
  });

  test('内容が同じ保存では通知しない', async ({ as }) => {
    const sato = await as('sato');
    await sato.put('/api/bank-accounts/me', { data: ACCOUNT });
    await mm.waitFor(p => p.message.includes('受取口座'));
    await mm.reset();
    await sato.put('/api/bank-accounts/me', { data: ACCOUNT });
    expect(await mm.quiet()).toHaveLength(0);
  });

  test('経理担当が自分の口座を登録したときは、本人以外にだけ届く', async ({ as }) => {
    await (await as('keiri')).put('/api/bank-accounts/me', { data: ACCOUNT });
    const posts = await mm.waitFor(p => p.message.includes('受取口座が登録・変更されました'));
    expect(recipients(posts)).toEqual([to('admin'), to('admin2')]);
  });

  test('給与の全銀データを振込済にすると、本人に支払済の通知が届く（金額・口座は載らない）', async ({ as }) => {
    await (await as('admin')).put('/api/zengin/settings', { data: { client_code: '1234567890', client_name: 'カ）サンプル', bank_code: '0001', bank_name: 'みずほ', branch_code: '123', branch_name: '本店', account_type: 'ordinary', account_number: '7654321' } });
    await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
    await verifyBankAccount(await as('keiri'), USERS.sato.id);
    const slip = await makePayslip({ role: 'sato', title: '10月分給与' });
    const claim = await makeClaim({ role: 'sato', status: 'approved', amount: 4800, payslipId: slip.id, title: '合算される経費' });
    const keiri = await as('keiri');
    const made = await (await keiri.post('/api/transfers/batches', { data: { kind: 'payroll', ids: [slip.id], transfer_date: jstDate(1) } })).json();
    await mm.reset();
    await keiri.post(`/api/transfers/batches/${made.id}/mark-paid`, { data: {} });
    expect((await mm.waitFor(p => p.message.includes('が支払済になりました'))).map(p => p.to)).toEqual([to('sato')]);
    expect((await mm.waitFor(p => p.message.includes('立替金が返金されました'))).map(p => p.to)).toEqual([to('sato')]); // the merged expense
    const all = await mm.posts();
    expect(all.every(p => p.to === to('sato'))).toBe(true);
    for (const p of all) { expect(p.message).not.toContain('1234567'); expect(p.message).not.toContain('サトウ'); }
    expect((await db.expense_claims.findUnique({ where: { id: claim.id } }))!.status).toBe('paid');
  });

  test('Mattermostが落ちていても、申請・承認・全銀データの作成は成功する', async ({ as }) => {
    await mm.fail(true);
    try {
      const sato = await as('sato');
      expect((await postClaim(sato, { title: '障害中の申請' })).status()).toBe(201);
      expect((await sato.put('/api/bank-accounts/me', { data: ACCOUNT })).status()).toBe(200);
      const v = await makeVendor();
      const res = await sato.post('/api/payments', { multipart: { vendor_id: v.id, title: '障害中の振込', amount: '5000', due_date: jstDate(3) } });
      expect(res.status()).toBe(201);
      expect((await (await as('admin')).post(`/api/payments/${(await res.json()).id}/review`, { data: { action: 'approve' } })).status()).toBe(200);
      expect(await mm.posts()).toHaveLength(0);
    } finally { await mm.fail(false); }
  });

  test('通知に失敗しても処理は戻り、失敗の記録が残る', async ({ as }) => {
    await mm.fail(true);
    const startedAt = new Date();
    try {
      expect((await postClaim(await as('sato'), { title: '失敗記録の申請' })).status()).toBe(201);
      await new Promise(r => setTimeout(r, 1500));
      // only this test's own DMs: late deliveries from the previous test must not count
      const rows = await db.mattermost_notifications.findMany({ where: { notification_type: 'expense_submitted', created_at: { gte: startedAt } } });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(r => r.status === 'failed')).toBe(true);
    } finally { await mm.fail(false); }
  });
});
