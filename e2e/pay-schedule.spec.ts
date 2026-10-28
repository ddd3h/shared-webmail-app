import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { resetExpenses, resetPayslips, resetWork, setWorkerType } from './helpers/seed';
import { closingDate, describeSchedule, payDate, periodOf, shortDate, DEFAULT_SCHEDULE } from '../src/lib/pay-schedule';
import { today } from './helpers/ui';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => { await db.pay_schedules.deleteMany({}); await resetExpenses(); await resetWork(); await resetPayslips(); });
test.afterEach(async () => { await setWorkerType(USERS.tanaka.id, 'employee'); await setWorkerType(USERS.sato.id, 'employee'); });
test.afterAll(async () => { await db.pay_schedules.deleteMany({}); await resetExpenses(); await resetWork(); await resetPayslips(); });

const SCHEDULE = { closing_day: 0, pay_month_offset: 1, pay_day: 25, pay_day_shift: 'before', report_deadline_days: 5, expense_deadline_days: 5 };
const noon = (date: string) => new Date(`${date}T03:00:00Z`); // 12:00 in Japan

async function claim(userId: string, o: { expense_date: string; created: string; status?: string; payment_method?: string }) {
  return db.expense_claims.create({ data: { user_id: userId, expense_date: new Date(`${o.expense_date}T00:00:00Z`), category: '交通費', title: `t-${o.created}`, amount: 1000, payment_method: o.payment_method ?? 'personal', status: o.status ?? 'pending', created_at: noon(o.created) } });
}

test.describe('設定（API）', () => {
  test('区分ごとの初期値: 末日締め・翌月25日払い。業務委託だけ翌月末日払い', async ({ as }) => {
    const res = await (await as('keiri')).get('/api/work/schedules');
    expect(res.status()).toBe(200);
    const { items } = await res.json();
    expect(items.map((i: { worker_type: string }) => i.worker_type)).toEqual(['executive', 'regular', 'part', 'dispatch', 'employee', 'contractor', 'quasi_contractor']);
    for (const i of items) expect(i).toMatchObject({ closing_day: 0, pay_month_offset: 1, pay_day: i.worker_type === 'contractor' || i.worker_type === 'quasi_contractor' ? 0 : 25, pay_day_shift: 'before', report_deadline_days: 5, expense_deadline_days: 5, custom: false });
    expect(items.find((i: { worker_type: string }) => i.worker_type === 'contractor').summary).toBe('末日締め・翌月末日払い');
    expect(items[0].label).toBe('役員');
  });

  test('一般ユーザーは見られず、変えられない。経理担当と管理者は変えられる', async ({ as }) => {
    expect((await (await as('sato')).get('/api/work/schedules')).status()).toBe(403);
    expect((await (await as('sato')).put('/api/work/schedules/regular', { data: SCHEDULE })).status()).toBe(403);
    expect((await (await as('keiri')).put('/api/work/schedules/regular', { data: { ...SCHEDULE, pay_day: 20 } })).status()).toBe(200);
    expect((await (await as('admin')).put('/api/work/schedules/part', { data: { ...SCHEDULE, closing_day: 15 } })).status()).toBe(200);
    const { items } = await (await (await as('admin')).get('/api/work/schedules')).json();
    const by = Object.fromEntries(items.map((i: { worker_type: string }) => [i.worker_type, i]));
    expect(by.regular).toMatchObject({ pay_day: 20, custom: true });
    expect(by.part).toMatchObject({ closing_day: 15, custom: true });
    expect(by.employee).toMatchObject({ pay_day: 25, custom: false });  // the other kinds are not touched
    const log = await db.audit_logs.findFirst({ where: { action_type: 'pay_schedule_update', target_id: 'regular' } });
    expect(JSON.parse(log!.metadata_json).to.pay_day).toBe(20);
  });

  test('不正な値は400、知らない区分は404', async ({ as }) => {
    const keiri = await as('keiri');
    for (const bad of [{ closing_day: 29 }, { closing_day: -1 }, { pay_month_offset: 3 }, { pay_day: 30 }, { pay_day_shift: 'x' }, { report_deadline_days: 32 }, { expense_deadline_days: 1.5 }, { pay_day: '25' }]) {
      expect((await keiri.put('/api/work/schedules/regular', { data: { ...SCHEDULE, ...bad } })).status(), JSON.stringify(bad)).toBe(400);
    }
    expect((await keiri.put('/api/work/schedules/regular', { data: { closing_day: 0 } })).status()).toBe(400);
    expect((await keiri.put('/api/work/schedules/intern', { data: SCHEDULE })).status()).toBe(404);
    expect(await db.pay_schedules.count()).toBe(0);
  });

  test('自分に当てはまる設定と、指定した期間の日付が返る。他人の分は経理・管理者だけ', async ({ as }) => {
    const sato = await as('sato');
    const mine = await (await sato.get('/api/work/schedule?month=2026-10')).json();
    expect(mine).toMatchObject({ worker_type: 'employee', summary: '末日締め・翌月25日払い' });
    expect(mine.period).toMatchObject({ month: '2026-10', start: '2026-10-01', closing_date: '2026-10-31', report_deadline: '2026-11-05', expense_deadline: '2026-11-05', pay_date: '2026-11-25' });
    expect((await sato.get(`/api/work/schedule?userId=${USERS.suzuki.id}`)).status()).toBe(403);
    expect((await sato.get('/api/work/schedule?month=2026-13')).status()).toBe(400);
    const theirs = await (await (await as('keiri')).get(`/api/work/schedule?userId=${USERS.suzuki.id}&month=2026-10`)).json();
    expect(theirs).toMatchObject({ worker_type: 'contractor', pay_day: 0 });
    expect(theirs.period.pay_date).toBe('2026-11-30');

    await (await as('keiri')).put('/api/work/schedules/employee', { data: { ...SCHEDULE, closing_day: 15, pay_month_offset: 0, pay_day: 20, pay_day_shift: 'none' } });
    const changed = await (await sato.get('/api/work/schedule?month=2026-10')).json();
    expect(changed.period).toMatchObject({ start: '2026-09-16', closing_date: '2026-10-15', pay_date: '2026-10-20' });
    // 区分を変えると、その区分の設定に変わる
    await setWorkerType(USERS.sato.id, 'regular');
    expect((await (await sato.get('/api/work/schedule?month=2026-10')).json()).period.pay_date).toBe('2026-11-25');
  });
});

test.describe('経費・業務報告・給与への反映', () => {
  test('経費: 期限までなら今期、過ぎたら次の期（1回分遅れる）。返金対象でないものには付かない', async ({ as }) => {
    const ok = await claim(USERS.sato.id, { expense_date: '2026-10-20', created: '2026-11-05' });
    const late = await claim(USERS.sato.id, { expense_date: '2026-10-21', created: '2026-11-06' });
    await claim(USERS.sato.id, { expense_date: '2026-10-22', created: '2026-10-22', payment_method: 'company' });
    await claim(USERS.sato.id, { expense_date: '2026-10-23', created: '2026-10-23', status: 'rejected' });
    const get = async () => Object.fromEntries((await (await (await as('sato')).get('/api/expenses')).json()).items.map((i: { id: string; pay_plan: unknown }) => [i.id, i.pay_plan]));
    let plans = await get();
    expect(plans[ok.id]).toEqual({ period: '2026-10', closing_date: '2026-10-31', deadline: '2026-11-05', pay_date: '2026-11-25', late: false });
    expect(plans[late.id]).toEqual({ period: '2026-11', closing_date: '2026-11-30', deadline: '2026-12-05', pay_date: '2026-12-25', late: true });
    expect(Object.values(plans).filter(p => p === null)).toHaveLength(2);
    // a longer deadline brings the late one back; 区分ごとに別
    await (await as('keiri')).put('/api/work/schedules/employee', { data: { ...SCHEDULE, expense_deadline_days: 10 } });
    plans = await get();
    expect(plans[late.id]).toMatchObject({ period: '2026-10', late: false, deadline: '2026-11-10' });
    await setWorkerType(USERS.sato.id, 'part');
    plans = await get();
    expect(plans[late.id]).toMatchObject({ period: '2026-11', late: true }); // 'part' still has the default 5 days
  });

  test('業務報告書: 期限を過ぎて出すと次の期になる（業務委託は翌月末日払い）', async ({ as }) => {
    const mk = (report_date: string, created: string) => db.work_reports.create({ data: { user_id: USERS.suzuki.id, report_date: new Date(`${report_date}T00:00:00Z`), title: `r-${created}`, content: 'x', created_at: noon(created) } });
    const a = await mk('2026-10-20', '2026-11-04');
    const b = await mk('2026-10-21', '2026-11-07');
    const { items } = await (await (await as('suzuki')).get('/api/work/reports?month=2026-10')).json();
    const by = Object.fromEntries(items.map((i: { id: string; pay_plan: unknown }) => [i.id, i.pay_plan]));
    expect(by[a.id]).toEqual({ period: '2026-10', closing_date: '2026-10-31', deadline: '2026-11-05', pay_date: '2026-11-30', late: false });
    expect(by[b.id]).toEqual({ period: '2026-11', closing_date: '2026-11-30', deadline: '2026-12-05', pay_date: '2026-12-31', late: true });
    // 経理担当 sees each person's own schedule
    const all = await (await (await as('keiri')).get('/api/work/reports?month=2026-10')).json();
    expect(all.items).toHaveLength(2);
  });

  test('立替金を給与明細に合算して新しく作る明細には、その区分の支払日が入る', async ({ as }) => {
    const c = await claim(USERS.sato.id, { expense_date: '2026-10-20', created: '2026-10-20', status: 'approved' });
    await (await as('keiri')).put('/api/work/schedules/employee', { data: { ...SCHEDULE, pay_month_offset: 0, pay_day: 20, pay_day_shift: 'none' } });
    const res = await (await as('keiri')).post('/api/expenses/reimburse', { data: { ids: [c.id], mode: 'payslip', pay_month: '2026-10' } });
    expect(res.status()).toBe(200);
    const slip = await db.payslips.findFirst({ where: { user_id: USERS.sato.id } });
    expect(slip!.pay_date!.toISOString().slice(0, 10)).toBe('2026-10-20');
  });

  test('給与明細を登録するときは、その人の区分の振込日が支払日の初期値になる（手で直せる）', async ({ browser, as }) => {
    await (await as('keiri')).put('/api/work/schedules/employee', { data: { ...SCHEDULE, pay_day: 10, pay_day_shift: 'none' } });
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await page.getByRole('button', { name: '管理', exact: true }).click();
    await page.getByRole('button', { name: '給与・報酬の管理', exact: true }).click();
    await page.getByRole('button', { name: /明細を登録/ }).click();
    const month = page.locator('label', { hasText: '対象月' }).first().locator('xpath=following-sibling::input[1]');
    const date = page.locator('label', { hasText: '支払日' }).first().locator('xpath=following-sibling::input[1]');
    await month.fill('2026-10');
    await expect(date).toHaveValue('2026-11-10');
    await expect(page.getByText(/末日締め・翌月10日払い/)).toBeVisible();
    await date.fill('2026-11-12');
    await month.fill('2026-11');
    await expect(date).toHaveValue('2026-11-12'); // typed by hand: left alone
    await ctx.close();
  });
});

test.describe('設定画面', () => {
  test('勤怠・給与の管理に「締め日・振込日」があり、区分ごとに変えて保存できる。例の日付がその場で変わる', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.keiri, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await page.getByRole('button', { name: '管理', exact: true }).click();
    await page.getByRole('button', { name: '締め日・振込日', exact: true }).click();
    const card = page.getByRole('region', { name: '正社員の締め日・振込日' });
    await expect(card).toContainText('初期値');
    await card.getByLabel('締め日', { exact: true }).selectOption('15');
    await card.getByLabel('支払月', { exact: true }).selectOption('0');
    await card.getByLabel('振込日', { exact: true }).selectOption('20');
    await card.getByLabel('土日のとき').selectOption('none');
    const s = { ...DEFAULT_SCHEDULE, closing_day: 15, pay_month_offset: 0, pay_day: 20, pay_day_shift: 'none' as const };
    const period = periodOf(today(), s);
    await expect(page.getByTestId('example-regular')).toContainText(`${Number(period.slice(5))}月分は ${shortDate(closingDate(period, s))} に締め、${shortDate(payDate(period, s))} に振込`);
    await expect(card).toContainText(describeSchedule(s));
    await card.getByLabel('経費の申請期限（締め日の何日後まで）').fill('3');
    await card.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('正社員の締め日・振込日を保存しました')).toBeVisible();
    await expect(card).toContainText('設定済み');
    expect(await db.pay_schedules.findUnique({ where: { worker_type: 'regular' } })).toMatchObject({ closing_day: 15, pay_month_offset: 0, pay_day: 20, pay_day_shift: 'none', expense_deadline_days: 3, report_deadline_days: 5 });
    // 業務報告書の期限は、業務委託・準業務委託の行だけにある
    await expect(card.getByLabel(/業務報告書の提出期限/)).toHaveCount(0);
    await expect(page.getByRole('region', { name: '業務委託の締め日・振込日', exact: true }).getByLabel(/業務報告書の提出期限/)).toBeVisible();
    await ctx.close();
  });

  test('業務委託の画面に、今期の締め日・提出期限・支払日が出る。一般の従業員には管理の画面がない', async ({ browser, as }) => {
    const ctx = await browser.newContext({ storageState: AUTH.suzuki, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await page.getByRole('button', { name: '業務報告', exact: true }).click();
    const s = { ...DEFAULT_SCHEDULE, pay_day: 0 };
    const period = periodOf(today(), s);
    await expect(page.getByTestId('report-schedule')).toContainText(`${Number(period.slice(5))}月分: 締め日 ${shortDate(closingDate(period, s))}`);
    await expect(page.getByTestId('report-schedule')).toContainText('末日締め・翌月末日払い');
    await ctx.close();
    expect((await (await as('suzuki')).put('/api/work/schedules/contractor', { data: SCHEDULE })).status()).toBe(403);
  });
});
