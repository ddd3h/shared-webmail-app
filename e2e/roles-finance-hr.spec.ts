import { test, expect } from './fixtures';
import { USERS } from './helpers/constants';
import { db } from './helpers/db';
import { makeClaim, makePayslip, makeTrip } from './helpers/factories';
import { jstDate, resetExpenses, resetOrg, resetPayslips, resetTrips, resetWork } from './helpers/seed';
import { CRITERIA } from './helpers/org';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => {
  await db.users.updateMany({ data: { is_hr: false } });
  await Promise.all([resetExpenses(), resetPayslips(), resetTrips(), resetOrg()]);
});
test.beforeEach(async () => { await db.users.updateMany({ data: { is_hr: false } }); await Promise.all([resetExpenses(), resetPayslips(), resetTrips(), resetOrg()]); });

test.describe('経理担当は、お金まわりを全社分扱える（承認だけは別）', () => {
  test('全員の経費を見られ、承認済みの立替を返金できる。承認・却下はできない', async ({ as }) => {
    const pending = await makeClaim({ role: 'tanaka', title: '経理が見る経費' });
    const approved = await makeClaim({ role: 'sato', status: 'approved', title: '返金する経費' });
    const keiri = await as('keiri');
    const all = (await (await keiri.get('/api/expenses?scope=all')).json()).items as { id: string }[];
    expect(all.map(c => c.id)).toEqual(expect.arrayContaining([pending.id, approved.id]));
    expect((await keiri.post(`/api/expenses/${pending.id}/review`, { data: { action: 'approve' } })).status()).toBe(403); // approving is not theirs
    const res = await keiri.post('/api/expenses/reimburse', { data: { ids: [approved.id], paid_date: jstDate(0) } });
    expect(res.status()).toBe(200);
    expect((await db.expense_claims.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe('paid');
  });

  test('全員の出張と、手当のマスタを扱える。承認はできない', async ({ as }) => {
    const trip = await makeTrip({ role: 'tanaka', status: 'pending' });
    const keiri = await as('keiri');
    expect(((await (await keiri.get('/api/trips?scope=all')).json()).items as { id: string }[]).map(t => t.id)).toContain(trip.id);
    expect((await keiri.post('/api/trips/allowance-types', { data: { name: '経理が作った手当', kind: 'addon', unit: 'per_day', amount: 700 } })).status()).toBe(201);
    expect((await keiri.post(`/api/trips/${trip.id}/review`, { data: { action: 'approve' } })).status()).toBe(403);
  });

  test('全員の勤怠・給与明細を見られ、ユーザー一覧を取れる。区分や担当の変更はできない', async ({ as }) => {
    await resetWork();
    const slip = await makePayslip({ role: 'tanaka', title: '経理が見る明細' });
    const keiri = await as('keiri');
    expect((await keiri.get(`/api/work/attendance?userId=${USERS.tanaka.id}`)).status()).toBe(200);
    const slips = (await (await keiri.get(`/api/work/payslips?userId=${USERS.tanaka.id}`)).json()).items as { id: string }[];
    expect(slips.map(s => s.id)).toContain(slip.id);
    const users = (await (await keiri.get('/api/work/users')).json()).items as { id: string }[];
    expect(users).toHaveLength(Object.keys(USERS).length);
    expect((await keiri.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { is_accounting: true } })).status()).toBe(403);
    expect((await keiri.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { is_hr: true } })).status()).toBe(403);
  });

  test('経理でない一般ユーザーは、どれも見られない', async ({ as }) => {
    const sato = await as('sato');
    for (const url of ['/api/expenses?scope=all', '/api/trips?scope=all', '/api/work/users', `/api/work/attendance?userId=${USERS.tanaka.id}`]) {
      expect((await sato.get(url)).status(), url).toBe(403);
    }
  });

  test('画面: 勤怠・給与の「管理」、経費・出張・振込のタブが出る。承認ボタンは出ない', async ({ browser }) => {
    await makeClaim({ role: 'tanaka', title: '画面で見る経費' });
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/keiri.json' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await expect(page.getByRole('button', { name: '管理', exact: true })).toBeVisible();
    await page.goto('/expenses');
    await page.getByRole('button', { name: '全員の申請・返金' }).click();
    await expect(page.getByText('画面で見る経費').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '承認', exact: true })).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('人事担当は、組織に関係なく全員の人事評価を見て運用できる', () => {
  const cycleBody = { name: '全社の評価', period_start: '2026-04-01', period_end: '2026-09-30', criteria: CRITERIA };

  test('管理者が「人事担当」を付けると、役職がなくても評価期間を作れ、全員の評価を見られる。外すと戻る', async ({ as }) => {
    const tanaka = await as('tanaka'); // no 役職, no unit
    expect((await tanaka.post('/api/evaluations/cycles', { data: cycleBody })).status()).toBe(403);
    expect((await tanaka.get('/api/evaluations?scope=all')).status()).toBe(403);

    const admin = await as('admin');
    expect((await admin.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { is_hr: true } })).status()).toBe(200);
    expect(await db.audit_logs.count({ where: { action_type: 'hr_role_update', target_id: USERS.tanaka.id } })).toBe(1);
    expect((await (await tanaka.get('/api/work/me')).json())).toMatchObject({ is_hr: true });
    expect((await tanaka.post('/api/evaluations/cycles', { data: cycleBody })).status()).toBe(201);
    expect((await tanaka.get('/api/evaluations?scope=all')).status()).toBe(200);

    expect((await admin.patch(`/api/work/users/${USERS.tanaka.id}`, { data: { is_hr: false } })).status()).toBe(200);
    expect((await tanaka.get('/api/evaluations?scope=all')).status()).toBe(403);
  });

  test('人事担当になっても、経費・給与・勤怠は見られない（評価だけ）', async ({ as }) => {
    await db.users.update({ where: { id: USERS.tanaka.id }, data: { is_hr: true } });
    const tanaka = await as('tanaka');
    expect((await tanaka.get('/api/expenses?scope=all')).status()).toBe(403);
    expect((await tanaka.get('/api/work/users')).status()).toBe(403);
  });

  test('人事担当を付けられるのは管理者だけ（本人にも、他の担当にも付けられない）', async ({ as }) => {
    for (const role of ['keiri', 'sato'] as const) {
      expect((await (await as(role)).patch(`/api/work/users/${USERS.sato.id}`, { data: { is_hr: true } })).status(), role).toBe(403);
    }
  });

  test('画面: 管理者の「区分・設定」に人事担当の欄があり、付けられる', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/admin.json' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await page.getByRole('button', { name: '管理', exact: true }).click();
    const box = page.getByLabel(`${USERS.tanaka.name}を人事担当にする`);
    await box.click(); // the box follows the server's answer, so it is not checked at the moment of the click
    await expect(page.getByText(/人事担当にしました/)).toBeVisible();
    await expect(box).toBeChecked();
    expect((await db.users.findUniqueOrThrow({ where: { id: USERS.tanaka.id } })).is_hr).toBe(true);
    await ctx.close();
  });
});
