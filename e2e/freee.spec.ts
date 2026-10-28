import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH, USERS, type Role } from './helpers/constants';
import { db } from './helpers/db';
import { mm } from './helpers/mattermost-mock';
import { jstDate, resetTransfers } from './helpers/seed';
import { makeClaim, makePayment, makePayslip, makeVendor } from './helpers/factories';

test.describe.configure({ mode: 'serial' });

const CLIENT = { client_id: 'e2e-freee-id', client_secret: 'e2e-freee-secret' };
const MAP = {
  salary: { account_item_id: 9001, tax_code: 0 }, executive: { account_item_id: 9002, tax_code: 0 }, contractor: { account_item_id: 9003, tax_code: 0 },
  payment: { account_item_id: 9004, tax_code: 0 }, expense: { account_item_id: 9006, tax_code: 0 }, 'expense:交通費': { account_item_id: 9005, tax_code: 0 },
};
type As = (r: Role) => Promise<APIRequestContext>;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test.beforeEach(async () => {
  await resetTransfers();
  await db.freee_exports.deleteMany({});
  await db.app_settings.deleteMany({ where: { key: { startsWith: 'FREEE_' } } });
  await mm.reset();
  for (const [id, t] of [[USERS.sato.id, 'employee'], [USERS.suzuki.id, 'contractor'], [USERS.yamada.id, 'executive']] as const) await db.users.update({ where: { id }, data: { worker_type: t } });
});
test.afterAll(async () => { await resetTransfers(); await db.freee_exports.deleteMany({}); await db.app_settings.deleteMany({ where: { key: { startsWith: 'FREEE_' } } }); });

/** The administrator's whole set-up, the way it is done on screen: the app's details, connect (through freee's own screen), the bank account, the accounts. */
async function setUp(as: As, o: { map?: boolean; auto?: boolean; from?: string } = {}) {
  const admin = await as('admin');
  expect((await admin.put('/api/admin/freee', { data: CLIENT })).status()).toBe(200);
  const back = await admin.get('/api/freee/auth');               // follows the redirects: freee's screen and back
  expect(back.url()).toContain('freee=connected');
  expect((await admin.put('/api/admin/freee', { data: { walletable: { id: 501, type: 'bank_account', name: 'みずほ銀行 普通' }, sync_from: o.from ?? jstDate(-2) } })).status()).toBe(200);
  if (o.map !== false) expect((await admin.put('/api/admin/freee', { data: { account_map: MAP } })).status()).toBe(200);
  if (o.auto) expect((await admin.put('/api/admin/freee', { data: { auto_sync: true } })).status()).toBe(200);
  return admin;
}
const sync = async (as: As) => (await as('keiri')).post('/api/freee/sync');

test.describe('権限', () => {
  test('設定はシステム管理者だけ。履歴と送信は経理担当と管理者', async ({ as, anon }) => {
    for (const role of ['sato', 'keiri'] as const) {
      const c = await as(role);
      expect((await c.get('/api/admin/freee')).status(), role).toBe(403);
      expect((await c.put('/api/admin/freee', { data: CLIENT })).status(), role).toBe(403);
      expect((await c.delete('/api/admin/freee')).status(), role).toBe(403);
      expect((await c.get('/api/admin/freee/options')).status(), role).toBe(403);
      expect((await c.get('/api/freee/auth', { maxRedirects: 0 })).status(), role).toBe(403);
    }
    const sato = await as('sato');
    expect((await sato.get('/api/freee/exports')).status()).toBe(403);
    expect((await sato.post('/api/freee/sync')).status()).toBe(403);
    expect((await (await as('keiri')).get('/api/freee/exports')).status()).toBe(200);
    expect((await anon.post('/api/freee/sync', { maxRedirects: 0 })).status()).not.toBe(200);
  });
});

test.describe('接続と設定', () => {
  test('最初は未設定。アプリの情報がないと接続できず、送信もできない', async ({ as }) => {
    const admin = await as('admin');
    expect(await (await admin.get('/api/admin/freee')).json()).toMatchObject({ client_id: null, has_secret: false, connected: false, ready: false, auto_sync: false });
    expect((await admin.get('/api/freee/auth', { maxRedirects: 0 })).status()).toBe(409);
    expect((await (await as('keiri')).post('/api/freee/sync')).status()).toBe(409);
    expect(await (await (await as('keiri')).get('/api/freee/exports')).json()).toMatchObject({ connected: false, ready: false });
  });

  test('Client Secret は暗号化して保存し、画面にも返さない', async ({ as }) => {
    const admin = await as('admin');
    expect((await admin.put('/api/admin/freee', { data: CLIENT })).status()).toBe(200);
    const got = await (await admin.get('/api/admin/freee')).json();
    expect(got).toMatchObject({ client_id: 'e2e-freee-id', has_secret: true });
    expect(JSON.stringify(got)).not.toContain('e2e-freee-secret');
    const row = await db.app_settings.findUnique({ where: { key: 'FREEE_CLIENT_SECRET' } });
    expect(row!.value).not.toContain('e2e-freee-secret');
    expect(row!.is_secret).toBe(true);
    // a save without a secret keeps the one that is there
    expect((await admin.put('/api/admin/freee', { data: { client_id: 'e2e-freee-id' } })).status()).toBe(200);
    expect((await (await admin.get('/api/admin/freee')).json()).has_secret).toBe(true);
  });

  test('freeeの画面で許可すると接続され、会社が1つなら自動で選ばれる。トークンは暗号化される', async ({ as }) => {
    const admin = await as('admin');
    await admin.put('/api/admin/freee', { data: CLIENT });
    const back = await admin.get('/api/freee/auth');
    expect(back.url()).toContain('/admin/settings?freee=connected');
    expect(await (await admin.get('/api/admin/freee')).json()).toMatchObject({ connected: true, ready: false, company: { id: 111, name: 'テスト株式会社' } });
    for (const key of ['FREEE_ACCESS_TOKEN', 'FREEE_REFRESH_TOKEN']) {
      const row = await db.app_settings.findUnique({ where: { key } });
      expect(row!.value).not.toMatch(/^(at|rt)-/);
      expect(row!.is_secret).toBe(true);
    }
    expect((await db.audit_logs.findFirst({ where: { action_type: 'freee_connect' } }))).toBeTruthy();
  });

  test('会社が複数なら選ぶまで未選択。選べるのは接続で見える会社だけ', async ({ as }) => {
    await mm.freee.companies(2);
    const admin = await as('admin');
    await admin.put('/api/admin/freee', { data: CLIENT });
    await admin.get('/api/freee/auth');
    expect((await (await admin.get('/api/admin/freee')).json()).company).toBeNull();
    const opts = await (await admin.get('/api/admin/freee/options')).json();
    expect(opts.companies.map((c: { id: number }) => c.id)).toEqual([111, 222]);
    expect((await admin.put('/api/admin/freee', { data: { company_id: 999 } })).status()).toBe(400);
    expect((await admin.put('/api/admin/freee', { data: { company_id: 222 } })).status()).toBe(200);
    expect((await (await admin.get('/api/admin/freee')).json()).company).toEqual({ id: 222, name: '別会社' });
  });

  test('接続の確認用の値(state)が違うと接続されない', async ({ as }) => {
    const admin = await as('admin');
    await admin.put('/api/admin/freee', { data: CLIENT });
    const res = await admin.get('/api/freee/callback?code=e2e-freee-code&state=forged', { maxRedirects: 0 });
    expect(res.headers().location).toContain('freee=invalid_state');
    expect((await (await admin.get('/api/admin/freee')).json()).connected).toBe(false);
  });

  test('口座と勘定科目の選択肢が取れる。口座・科目の入力が不正なら400。自動送信は準備ができてから', async ({ as }) => {
    const admin = await as('admin');
    await admin.put('/api/admin/freee', { data: CLIENT });
    await admin.get('/api/freee/auth');
    const opts = await (await admin.get('/api/admin/freee/options')).json();
    expect(opts.walletables.map((w: { id: number }) => w.id)).toEqual([501, 502]);
    expect(opts.account_items.map((a: { name: string }) => a.name)).toContain('役員報酬');
    expect((await admin.put('/api/admin/freee', { data: { auto_sync: true } })).status()).toBe(409);
    expect((await admin.put('/api/admin/freee', { data: { walletable: { id: 999, type: 'bank_account' } } })).status()).toBe(400);
    for (const bad of [{ nope: { account_item_id: 1, tax_code: 0 } }, { salary: { account_item_id: 0, tax_code: 0 } }, { salary: { account_item_id: 'x' } }]) {
      expect((await admin.put('/api/admin/freee', { data: { account_map: bad } })).status(), JSON.stringify(bad)).toBe(400);
    }
    expect((await admin.put('/api/admin/freee', { data: { sync_from: '2026-1-1' } })).status()).toBe(400);
    await admin.put('/api/admin/freee', { data: { walletable: { id: 501, type: 'bank_account' }, sync_from: jstDate(-2) } });
    expect((await admin.put('/api/admin/freee', { data: { auto_sync: true } })).status()).toBe(200);
    expect((await (await admin.get('/api/admin/freee')).json())).toMatchObject({ ready: true, auto_sync: true, walletable: { id: 501 } });
  });

  test('接続を外すと、トークン・会社・口座が消え、送れなくなる（送った記録は残る）', async ({ as }) => {
    const admin = await setUp(as);
    await db.freee_exports.create({ data: { source_type: 'payment', source_id: 'x', status: 'sent', amount: 1, paid_date: new Date(), description: 'd', freee_deal_id: 1 } });
    expect((await admin.delete('/api/admin/freee')).status()).toBe(200);
    expect(await (await admin.get('/api/admin/freee')).json()).toMatchObject({ connected: false, ready: false, company: null, walletable: null, auto_sync: false });
    expect(await db.app_settings.count({ where: { key: { in: ['FREEE_ACCESS_TOKEN', 'FREEE_REFRESH_TOKEN'] } } })).toBe(0);
    expect((await sync(as)).status()).toBe(409);
    expect(await db.freee_exports.count()).toBe(1);
  });
});

test.describe('freeeへの送信', () => {
  async function paidThings() {
    const salary = await makePayslip({ role: 'sato', status: 'paid', payDate: jstDate(0), items: [{ kind: 'earning', label: '基本給', amount: 300000 }, { kind: 'deduction', label: '社保', amount: 45000 }] });
    const fee = await makePayslip({ role: 'suzuki', title: '報酬', status: 'paid', payDate: jstDate(0), items: [{ kind: 'earning', label: '業務委託費', amount: 200000 }] });
    const exec = await makePayslip({ role: 'yamada', title: '報酬', status: 'paid', payDate: jstDate(0), items: [{ kind: 'earning', label: '役員報酬', amount: 500000 }] });
    const vendor = await makeVendor({ name: '株式会社テスト商事', verified: true });
    const payment = await makePayment({ vendorId: vendor.id, status: 'paid', amount: 110000, deduction: 10000, due: jstDate(0) });
    const trip = await makeClaim({ role: 'tanaka', status: 'paid', amount: 1200, category: '交通費' });
    const meeting = await makeClaim({ role: 'tanaka', status: 'paid', amount: 800, category: '会議費' });
    return { salary, fee, exec, payment, trip, meeting };
  }

  test('支払い済みの給与・業務委託費・役員報酬・振込申請・経費が、勘定科目の割り当てどおりに、1件ずつ支出の取引として送られる', async ({ as }) => {
    await setUp(as);
    await paidThings();
    const res = await sync(as);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 6, failed: 0, skipped: 0 });
    const { deals } = await mm.freee.state();
    expect(deals).toHaveLength(6);
    for (const d of deals) {
      expect(d).toMatchObject({ company_id: 111, type: 'expense', version: '2020-06-15' });
      expect(d.payments).toHaveLength(1);
      expect(d.payments[0]).toMatchObject({ from_walletable_id: 501, from_walletable_type: 'bank_account', date: d.issue_date, amount: d.details.reduce((s: number, x: { amount: number }) => s + x.amount, 0) });
    }
    const by = (acct: number) => deals.filter(d => d.details[0].account_item_id === acct);
    expect(by(9001)[0].details).toMatchObject([{ amount: 255000, tax_code: 0 }]);   // 給与は手取り（支給−控除）
    expect(by(9003)[0].details[0].amount).toBe(200000);
    expect(by(9002)[0].details[0].amount).toBe(500000);
    expect(by(9004)[0].details[0].amount).toBe(100000);                              // 振込申請は振り込んだ額（申請額−控除）
    expect(by(9004)[0].details[0].description).toContain('株式会社テスト商事');
    expect(by(9005)[0].details[0].amount).toBe(1200);                                // 交通費は科目の指定
    expect(by(9006)[0].details[0].amount).toBe(800);                                 // それ以外の経費は「経費の立替金」の科目
    expect(by(9001)[0].issue_date).toBe(jstDate(0));
    const rows = await db.freee_exports.findMany();
    expect(rows).toHaveLength(6);
    expect(rows.every(r => r.status === 'sent' && r.freee_deal_id !== null && r.sent_at !== null)).toBe(true);
    expect((await db.audit_logs.findFirst({ where: { action_type: 'freee_sync' } }))).toBeTruthy();
  });

  test('もう一度送っても、同じものは送らない。支払い前・開始日より前のものも送らない', async ({ as }) => {
    await setUp(as);
    await paidThings();
    await makePayslip({ role: 'sato', status: 'planned', payDate: jstDate(0), title: '未払い' });
    await makePayslip({ role: 'sato', status: 'paid', payDate: jstDate(-10), title: '開始日より前' });
    await makeClaim({ role: 'sato', status: 'approved', amount: 500 });
    expect((await (await sync(as)).json()).sent).toBe(6);
    expect(await (await sync(as)).json()).toMatchObject({ sent: 0, failed: 0 });
    expect((await mm.freee.state()).deals).toHaveLength(6);
  });

  test('給与明細に合算された立替金は、明細の取引の中で経費の科目に分けて送る（二重には送らない）', async ({ as }) => {
    await setUp(as);
    const slip = await makePayslip({ role: 'sato', status: 'paid', payDate: jstDate(0), items: [{ kind: 'earning', label: '基本給', amount: 100000 }] });
    await makeClaim({ role: 'sato', status: 'paid', amount: 3000, category: '交通費', payslipId: slip.id });
    await db.payslip_items.create({ data: { payslip_id: slip.id, kind: 'earning', label: '立替金精算（1件）', amount: 3000, system_key: 'expense_reimbursement', sort: 1000 } });
    expect(await (await sync(as)).json()).toMatchObject({ sent: 1 });
    const { deals } = await mm.freee.state();
    expect(deals).toHaveLength(1);
    expect(deals[0].details.map((x: { account_item_id: number; amount: number }) => [x.account_item_id, x.amount])).toEqual([[9001, 100000], [9005, 3000]]);
    expect(deals[0].payments[0].amount).toBe(103000);
  });

  test('勘定科目が未設定のものは失敗として残り、設定して再送すると送られる。「送らない」にもできる。送信済みは再送できない', async ({ as }) => {
    await setUp(as, { map: false });
    const t = await paidThings();
    const keiri = await as('keiri');
    expect(await (await sync(as)).json()).toMatchObject({ sent: 0, failed: 6 });
    const list = await (await keiri.get('/api/freee/exports')).json();
    expect(list.counts).toMatchObject({ failed: 6, sent: 0 });
    const exec = list.items.find((i: { source_id: string }) => i.source_id === t.exec.id);
    expect(exec.error).toContain('勘定科目が未設定です: 役員報酬');
    expect((await mm.freee.state()).deals).toHaveLength(0);

    await (await as('admin')).put('/api/admin/freee', { data: { account_map: MAP } });
    // retry one, skip another; the rest are retried by the next send as they are
    expect((await keiri.post(`/api/freee/exports/${exec.id}`, { data: { action: 'retry' } })).status()).toBe(200);
    const feeRow = list.items.find((i: { source_id: string }) => i.source_id === t.fee.id);
    expect((await keiri.post(`/api/freee/exports/${feeRow.id}`, { data: { action: 'skip' } })).status()).toBe(200);
    expect(await (await sync(as)).json()).toMatchObject({ sent: 5, failed: 0 });
    expect((await mm.freee.state()).deals).toHaveLength(5);
    const after = await (await keiri.get('/api/freee/exports')).json();
    expect(after.items.find((i: { id: string }) => i.id === feeRow.id).status).toBe('skipped');
    const sent = after.items.find((i: { status: string }) => i.status === 'sent');
    expect((await keiri.post(`/api/freee/exports/${sent.id}`, { data: { action: 'retry' } })).status()).toBe(409);
    expect((await keiri.post('/api/freee/exports/nope', { data: { action: 'retry' } })).status()).toBe(404);
    expect((await keiri.post(`/api/freee/exports/${exec.id}`, { data: { action: 'x' } })).status()).toBe(400);
  });

  test('freeeが落ちている・断られたときは失敗として理由を残し、直ったあと1回だけ送られる（取引は重ならない）', async ({ as }) => {
    await setUp(as);
    await makePayslip({ role: 'sato', status: 'paid', payDate: jstDate(0) });
    await mm.freee.fail('down');
    expect(await (await sync(as)).json()).toMatchObject({ sent: 0, failed: 1 });
    await mm.freee.fail('invalid');
    expect(await (await sync(as)).json()).toMatchObject({ sent: 0, failed: 1 });
    const row = (await db.freee_exports.findMany())[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 2 });
    expect(row.error).toContain('勘定科目が不正です');
    await mm.freee.fail(null);
    expect(await (await sync(as)).json()).toMatchObject({ sent: 1, failed: 0 });
    expect(await db.freee_exports.count()).toBe(1);
    expect((await mm.freee.state()).deals).toHaveLength(1);
    expect(await db.freee_exports.findFirst()).toMatchObject({ status: 'sent', attempts: 3, error: null });
  });

  test('アクセストークンが切れたら、リフレッシュトークンで取り直して送る（新しいトークンに置き換わる）', async ({ as }) => {
    await setUp(as);
    await makePayslip({ role: 'sato', status: 'paid', payDate: jstDate(0) });
    const before = (await db.app_settings.findUnique({ where: { key: 'FREEE_REFRESH_TOKEN' } }))!.value;
    await mm.freee.expireAccessToken();
    expect(await (await sync(as)).json()).toMatchObject({ sent: 1 });
    const state = await mm.freee.state();
    expect(state.tokenCalls).toEqual(['authorization_code', 'refresh_token']);
    expect((await db.app_settings.findUnique({ where: { key: 'FREEE_REFRESH_TOKEN' } }))!.value).not.toBe(before);
    // and a second send works with the new one
    await makePayslip({ role: 'tanaka', status: 'paid', payDate: jstDate(0) });
    await mm.freee.expireAccessToken();
    expect(await (await sync(as)).json()).toMatchObject({ sent: 1 });
    expect((await mm.freee.state()).deals).toHaveLength(2);
  });

  test('同時に2回押しても、取引は1件ずつしか作られない', async ({ as }) => {
    await setUp(as);
    for (let i = 0; i < 4; i++) await makePayslip({ role: 'sato', status: 'paid', payDate: jstDate(0), title: `給与${i}` });
    const [a, b] = await Promise.all([sync(as), sync(as)]);
    expect([a.status(), b.status()]).toEqual([200, 200]);
    expect((await mm.freee.state()).deals).toHaveLength(4);
    expect(await db.freee_exports.count({ where: { status: 'sent' } })).toBe(4);
  });

  test('止まったままの「送信中」は自動では再送せず、確認を促す', async ({ as }) => {
    await setUp(as);
    const p = await makePayslip({ role: 'sato', status: 'paid', payDate: jstDate(0) });
    await db.freee_exports.create({ data: { source_type: 'payslip', source_id: p.id, status: 'sending', amount: 255000, paid_date: new Date(), description: 'x', attempts: 1, updated_at: new Date(Date.now() - 3600_000) } });
    expect(await (await sync(as)).json()).toMatchObject({ sent: 0 });
    expect((await mm.freee.state()).deals).toHaveLength(0);
    const row = await db.freee_exports.findFirst();
    expect(row!.status).toBe('failed');
    expect(row!.error).toContain('freeeに同じ取引がないか確認');
    // after a person looked: retry
    const id = row!.id;
    expect(((await (await as('keiri')).post(`/api/freee/exports/${id}`, { data: { action: 'retry' } })).status())).toBe(200);
    expect(await (await sync(as)).json()).toMatchObject({ sent: 1 });
  });

  test('自動送信がオンなら、振込済にした直後に送られる。オフなら送られない', async ({ as }) => {
    const admin = await setUp(as, { auto: true });
    const vendor = await makeVendor({ verified: true });
    const pay = await makePayment({ vendorId: vendor.id, status: 'approved', amount: 33000, due: jstDate(0) });
    expect(((await (await as('keiri')).post('/api/payments/mark-paid', { data: { ids: [pay.id] } })).status())).toBe(200);
    for (let i = 0; i < 30 && (await mm.freee.state()).deals.length === 0; i++) await sleep(200);
    const { deals } = await mm.freee.state();
    expect(deals).toHaveLength(1);
    expect(deals[0].details[0]).toMatchObject({ account_item_id: 9004, amount: 33000 });

    await admin.put('/api/admin/freee', { data: { auto_sync: false } });
    const pay2 = await makePayment({ vendorId: vendor.id, status: 'approved', amount: 4400, due: jstDate(0) });
    await (await as('keiri')).post('/api/payments/mark-paid', { data: { ids: [pay2.id] } });
    await sleep(1500);
    expect((await mm.freee.state()).deals).toHaveLength(1);
    expect((await (await (await as('keiri')).get('/api/freee/exports')).json()).counts.waiting).toBe(1);
  });
});

test.describe('画面', () => {
  test('管理者: システム設定の「freee連携」で、アプリの情報の保存・接続・口座と勘定科目の選択ができる', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: /^freee連携/ }).first().click();
    await expect(page.getByTestId('freee-redirect-uri')).toContainText('/api/freee/callback');
    await page.getByLabel('Client ID').fill(CLIENT.client_id);
    await page.getByLabel('Client Secret').fill(CLIENT.client_secret);
    await page.getByRole('button', { name: 'アプリの情報を保存' }).click();
    await expect(page.getByText('アプリの情報を保存しました')).toBeVisible();
    await page.getByRole('link', { name: 'freeeに接続' }).click();           // through freee's screen and back
    await expect(page.getByText('freeeに接続しました')).toBeVisible();
    await page.getByRole('button', { name: /^freee連携/ }).first().click().catch(() => {});
    await expect(page.getByLabel('会社（事業所）')).toHaveValue('111');
    await page.getByLabel('支払元の口座（振込をする銀行口座）').selectOption('501');
    await expect(page.getByText('口座を選びました')).toBeVisible();
    await page.getByLabel('給与（正社員・パート・派遣・従業員）', { exact: true }).selectOption('9001');
    await page.getByLabel('役員報酬', { exact: true }).selectOption('9002');
    await page.getByRole('button', { name: '勘定科目を保存' }).click();
    await expect(page.getByText('勘定科目の割り当てを保存しました')).toBeVisible();
    const saved = JSON.parse((await db.app_settings.findUnique({ where: { key: 'FREEE_ACCOUNT_MAP' } }))!.value);
    expect(saved).toMatchObject({ salary: { account_item_id: 9001, tax_code: 0 }, executive: { account_item_id: 9002 } });
    // automatic sending needs the start day: before it is saved the box answers with a hint
    await page.getByLabel('この日以降に支払ったものを送る').fill(jstDate(-2));
    await page.getByRole('button', { name: '開始日を保存' }).click();
    await expect(page.getByText('連携の開始日を保存しました')).toBeVisible();
    await page.getByLabel(/支払い済みになったら自動でfreeeに送る/).click();
    await expect(page.getByText('自動送信をオンにしました')).toBeVisible();
    await ctx.close();
  });

  test('経理担当: 「freee連携」のタブ。未設定なら案内、設定後は「今すぐ送る」で送り、一覧に出る', async ({ browser, as }) => {
    const keiri = await browser.newContext({ storageState: AUTH.keiri, locale: 'ja-JP' });
    const page = await keiri.newPage();
    await page.goto('/transfers');
    await page.getByRole('button', { name: 'freee連携', exact: true }).click();
    await expect(page.getByTestId('freee-not-ready')).toBeVisible();

    await setUp(as);
    await makePayslip({ role: 'sato', status: 'paid', payDate: jstDate(0) });
    await makePayslip({ role: 'suzuki', title: '報酬', status: 'paid', payDate: jstDate(0), items: [{ kind: 'earning', label: '業務委託費', amount: 150000 }] });
    await page.reload();
    await page.getByRole('button', { name: 'freee連携', exact: true }).click();
    await expect(page.getByRole('region', { name: '送信待ち' })).toContainText('給与');
    await page.getByRole('button', { name: '今すぐ送る' }).click();
    await expect(page.getByText('2件を送りました')).toBeVisible();
    const log = page.getByRole('region', { name: '送信の記録' });
    await expect(log.getByText('送信済み').first()).toBeVisible();
    await expect(log).toContainText('¥150,000');
    await expect(log).toContainText('freeeの取引ID');
    await keiri.close();
  });
});
