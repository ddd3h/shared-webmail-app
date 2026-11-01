import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { resetWork, setWorkerType } from './helpers/seed';
import { jstDate } from './helpers/seed';
import { field } from './helpers/ui';

// 準業務委託の業務報告書は、1期間（月）に1通でよい。すでに何通も出していた人の分は、1通にまとめる。
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => {
  await resetWork();
  await db.pay_schedules.deleteMany({});
  await setWorkerType(USERS.sato.id, 'quasi_contractor');
  await setWorkerType(USERS.suzuki.id, 'contractor');
});
test.afterAll(async () => { await resetWork(); await setWorkerType(USERS.sato.id, 'employee'); });

const month = () => jstDate(0).slice(0, 7);
const day = (n: number) => `${month()}-${String(n).padStart(2, '0')}`;
const lastMonth = () => { const d = new Date(`${month()}-15T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
const body = (o: Record<string, unknown> = {}) => ({ report_date: day(5), title: '作業報告', content: '実施した内容', hours: 8, ...o });
type As = (r: any) => Promise<import('@playwright/test').APIRequestContext>;
const seedReport = (userId: string, date: string, title: string, o: { hours?: number | null; at?: string; flag?: boolean } = {}) => db.work_reports.create({
  data: { id: `wr-${Math.random().toString(36).slice(2, 10)}`, user_id: userId, report_date: new Date(`${date}T00:00:00Z`), title, content: `${title}の内容`, hours: o.hours ?? null, activity_flag: !!o.flag, activity_note: o.flag ? 'ログインの記録なし' : null, created_at: new Date(o.at ?? `${date}T03:00:00Z`) },
});

test.describe('1期間に1通（API）', () => {
  test('準業務委託は、同じ月の2通目は出せない（409）。すでにある報告書を教えてくれる。別の月なら出せる', async ({ as }: { as: As }) => {
    const c = await as('sato');
    const first = await c.post('/api/work/reports', { data: body() });
    expect(first.status()).toBe(201);
    const id = (await first.json()).id;
    const second = await c.post('/api/work/reports', { data: body({ report_date: day(20), title: '2通目' }) });
    expect(second.status()).toBe(409);
    expect(await second.json()).toMatchObject({ error: 'period_already_reported', id, report_date: day(5) });
    expect(await db.work_reports.count({ where: { user_id: USERS.sato.id } })).toBe(1);
    expect((await c.post('/api/work/reports', { data: body({ report_date: lastMonth(), title: '先月分' }) })).status()).toBe(201);
  });

  test('出した報告書は、その月のうちなら何度でも直せる。別の月の報告書がある月へ日付を動かすことはできない', async ({ as }: { as: As }) => {
    const c = await as('sato');
    const id = (await (await c.post('/api/work/reports', { data: body() })).json()).id;
    await c.post('/api/work/reports', { data: body({ report_date: lastMonth(), title: '先月分' }) });
    expect((await c.patch(`/api/work/reports/${id}`, { data: body({ content: '追記しました', report_date: day(25) }) })).status()).toBe(200);
    expect((await db.work_reports.findUniqueOrThrow({ where: { id } })).content).toBe('追記しました');
    const moved = await c.patch(`/api/work/reports/${id}`, { data: body({ report_date: lastMonth() }) });
    expect(moved.status()).toBe(409);
    expect((await moved.json()).error).toBe('period_already_reported');
  });

  test('業務委託（準ではない）は、これまでどおり何通でも出せる', async ({ as }: { as: As }) => {
    const c = await as('suzuki');
    for (const n of [3, 10, 17]) expect((await c.post('/api/work/reports', { data: body({ report_date: day(n), title: `報告${n}` }) })).status()).toBe(201);
    expect(await db.work_reports.count({ where: { user_id: USERS.suzuki.id } })).toBe(3);
  });

  test('締め日が15日の設定なら、期間は「前月16日〜15日」で数える', async ({ as }: { as: As }) => {
    await db.pay_schedules.upsert({ where: { worker_type: 'quasi_contractor' }, create: { worker_type: 'quasi_contractor', closing_day: 15, pay_month_offset: 1, pay_day: 25, pay_day_shift: 'before', report_deadline_days: 5, expense_deadline_days: 5 }, update: { closing_day: 15 } });
    const c = await as('sato');
    expect((await c.post('/api/work/reports', { data: body({ report_date: '2026-10-10' }) })).status()).toBe(201);
    expect((await c.post('/api/work/reports', { data: body({ report_date: '2026-09-20' }) })).status()).toBe(409); // 9/16〜10/15 は同じ期間
    expect((await c.post('/api/work/reports', { data: body({ report_date: '2026-10-16' }) })).status()).toBe(201); // 10/16〜11/15 は次の期間
  });
});

test.describe('すでに何通も出している報告書をまとめる', () => {
  const setUp = async () => {
    await seedReport(USERS.sato.id, day(6), '第1週', { hours: 8.5, at: `${day(7)}T00:00:00Z` });
    await seedReport(USERS.sato.id, day(13), '第2週', { hours: 4, at: `${day(14)}T00:00:00Z`, flag: true });
    await seedReport(USERS.sato.id, day(20), '第3週', { at: `${day(21)}T00:00:00Z` });
    await seedReport(USERS.sato.id, lastMonth(), '先月分', { hours: 2 });
    await seedReport(USERS.suzuki.id, day(4), '業務委託の報告A');
    await seedReport(USERS.suzuki.id, day(5), '業務委託の報告B');
  };

  test('まず対象の一覧だけを見られる（何も変わらない）。経理担当と管理者だけ。ほかの人は403', async ({ as }: { as: As }) => {
    await setUp();
    expect((await (await as('tanaka')).post('/api/work/reports/merge', { data: {} })).status()).toBe(403);
    expect((await (await as('sato')).post('/api/work/reports/merge', { data: {} })).status()).toBe(403);
    const res = await (await as('keiri')).post('/api/work/reports/merge', { data: {} });
    expect(res.status()).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ applied: false, merged_reports: 3 });
    expect(d.items).toEqual([expect.objectContaining({ user_id: USERS.sato.id, user_name: expect.any(String), period: month(), count: 3 })]);
    expect(await db.work_reports.count({ where: { user_id: USERS.sato.id } })).toBe(4); // nothing changed
  });

  test('まとめると、その月の報告書が1通になる。内容は全部残り、稼働時間は合計、印も残る。業務委託と先月分には触らない', async ({ as }: { as: As }) => {
    await setUp();
    expect((await (await as('keiri')).post('/api/work/reports/merge', { data: { apply: true } })).status()).toBe(200);
    const mine = await db.work_reports.findMany({ where: { user_id: USERS.sato.id }, orderBy: { report_date: 'asc' } });
    expect(mine).toHaveLength(2);
    const [prev, now] = mine;
    expect(prev.title).toBe('先月分');
    expect(now.title).toBe(`${Number(month().slice(5))}月分 業務報告`);
    expect(now.content).toContain(`■ ${day(6)} 第1週\n第1週の内容`);
    expect(now.content).toContain(`■ ${day(13)} 第2週\n第2週の内容`);
    expect(now.content).toContain(`■ ${day(20)} 第3週\n第3週の内容`);
    expect(Number(now.hours)).toBe(12.5);
    expect(now.report_date.toISOString().slice(0, 10)).toBe(day(20));
    expect(now.created_at.toISOString()).toBe(`${day(7)}T00:00:00.000Z`); // the oldest handing-in is kept
    expect(now.activity_flag).toBe(true);
    expect(await db.work_reports.count({ where: { user_id: USERS.suzuki.id } })).toBe(2);
    expect(await db.audit_logs.count({ where: { action_type: 'work_reports_merged', target_id: USERS.sato.id } })).toBe(1);
    // nothing left to put together; the person's own list shows the one report
    const again = await (await (await as('keiri')).post('/api/work/reports/merge', { data: { apply: true } })).json();
    expect(again.items).toEqual([]);
    const list = await (await (await as('sato')).get(`/api/work/reports?month=${month()}`)).json();
    expect(list.items).toHaveLength(1);
  });
});

test.describe('画面', () => {
  test.describe('準業務委託の本人', () => {
    test.use({ storageState: AUTH.sato });
    test('「月に1通でよい」と出る。2通目を作ろうとすると、すでにある報告書に案内される', async ({ page }) => {
      await seedReport(USERS.sato.id, day(5), '今月の報告', { hours: 3 });
      await page.goto('/work');
      await page.getByRole('button', { name: '業務報告', exact: true }).click();
      await expect(page.getByTestId('monthly-note')).toContainText('月に1通');
      await page.getByRole('button', { name: '＋ 報告書を作成' }).click();
      await field(page, '対象日').fill(day(20));
      await field(page, '件名').fill('二通目');
      await field(page, '報告内容').fill('追加の内容');
      await page.getByRole('button', { name: '提出', exact: true }).click();
      await expect(page.getByText('この月の報告書は、もう提出されています')).toBeVisible();
      await expect(page.getByText('今月の報告').first()).toBeVisible();
      expect(await db.work_reports.count({ where: { user_id: USERS.sato.id } })).toBe(1);
    });
  });
  test.describe('業務委託の本人', () => {
    test.use({ storageState: AUTH.suzuki });
    test('「月に1通」の案内は出ない', async ({ page }) => {
      await page.goto('/work');
      await page.getByRole('button', { name: '業務報告', exact: true }).click();
      await expect(page.getByTestId('monthly-note')).toHaveCount(0);
    });
  });
  test.describe('経理担当', () => {
    test.use({ storageState: AUTH.keiri });
    test('管理画面の報告書の一覧から、まとめる対象を確認して、まとめられる', async ({ page }) => {
      await seedReport(USERS.sato.id, day(6), '第1週', { hours: 1 });
      await seedReport(USERS.sato.id, day(13), '第2週', { hours: 2 });
      await page.goto('/work');
      await page.getByRole('button', { name: '管理', exact: true }).click();
      await page.getByRole('button', { name: /業務報告/ }).first().click();
      await page.getByTestId('merge-reports').click();
      await expect(page.getByTestId('merge-plan')).toContainText('2通 → 1通');
      await page.getByRole('button', { name: 'まとめる', exact: true }).click();
      await expect(page.getByText('1件を、1通にまとめました')).toBeVisible();
      expect(await db.work_reports.count({ where: { user_id: USERS.sato.id } })).toBe(1);
    });
  });
});
