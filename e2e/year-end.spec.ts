import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { today } from './helpers/ui';

test.describe.configure({ mode: 'serial' });

const YEAR = Number(today().slice(0, 4));
const person = (o: Record<string, unknown> = {}) => ({ name: '佐藤花子', birth_date: '1990-04-01', cohabiting: true, income_estimate: 400_000, disability: 'none', non_resident: false, ...o });
const form = (o: Record<string, unknown> = {}) => ({
  self: { single_status: 'none', disability: 'none', working_student: false },
  spouse: person(),
  dependents: [{ ...person({ name: '佐藤一郎', birth_date: '2015-03-03', income_estimate: 0 }), relation: 'child' }],
  deductions: { life_insurance: 60_000, earthquake_insurance: null, social_insurance: null, small_business_mutual_aid: null, housing_loan: false },
  previous_job: { has: false, company: '', income: null, tax_withheld: null, social_insurance: null },
  note: '',
  ...o,
});
const url = (path: string, year = YEAR) => `${path}?year=${year}`;

test.beforeEach(async () => {
  await db.year_end_declarations.deleteMany();
  await db.users.updateMany({ where: { id: USERS.tanaka.id }, data: { is_hr: false } });
});
test.afterAll(async () => {
  await db.year_end_declarations.deleteMany();
  await db.users.updateMany({ data: { is_hr: false } });
});

test.describe('年末調整（API）', () => {
  test('保存して読み戻せる。中身は暗号化され、監査ログには家族の名前を残さない', async ({ as }) => {
    const c = await as('sato');
    const first = await (await c.get(url('/api/profile/year-end'))).json();
    expect(first).toMatchObject({ applicable: true, year: YEAR, status: 'none', default_year: YEAR });
    expect(first.years).toEqual([YEAR - 1, YEAR, YEAR + 1]);
    expect(first.data.spouse).toBeNull();

    const put = await c.put(url('/api/profile/year-end'), { data: form() });
    expect(put.status()).toBe(200);
    expect((await put.json()).status).toBe('draft');
    const back = await (await c.get(url('/api/profile/year-end'))).json();
    expect(back.data.spouse.name).toBe('佐藤花子');
    expect(back.data.dependents).toHaveLength(1);

    const row = await db.year_end_declarations.findFirstOrThrow({ where: { user_id: USERS.sato.id } });
    expect(row.data_enc).not.toContain('佐藤花子');
    const log = await db.audit_logs.findFirstOrThrow({ where: { action_type: 'year_end_save', target_id: USERS.sato.id } });
    expect(log.metadata_json).not.toContain('佐藤');
  });

  test('年ごとに別々。提出できる年は去年・今年・来年だけ', async ({ as }) => {
    const c = await as('sato');
    await c.put(url('/api/profile/year-end'), { data: form() });
    expect((await (await c.get(url('/api/profile/year-end', YEAR + 1))).json()).status).toBe('none');
    expect((await c.get(url('/api/profile/year-end', YEAR + 2))).status()).toBe(400);
    expect((await c.put(url('/api/profile/year-end', YEAR - 5), { data: form() })).status()).toBe(400);
  });

  test('形が違う入力は400: 日付・金額・扶養親族11人', async ({ as }) => {
    const c = await as('sato');
    const bad = async (data: unknown) => (await c.put(url('/api/profile/year-end'), { data })).status();
    expect(await bad(form({ spouse: person({ birth_date: '2026-02-30' }) }))).toBe(400);
    expect(await bad(form({ deductions: { ...form().deductions, life_insurance: -1 } }))).toBe(400);
    expect(await bad(form({ deductions: { ...form().deductions, life_insurance: 1.5 } }))).toBe(400);
    expect(await bad(form({ dependents: Array.from({ length: 11 }, () => ({ ...person(), relation: 'child' })) }))).toBe(400);
    expect(await bad(form({ dependents: [{ ...person(), relation: 'cat' }] }))).toBe(400);
    expect(await bad({ nope: true })).toBe(400);
    expect(await db.year_end_declarations.count()).toBe(0);
  });

  test('提出: 保存してからでないと出せず、家族の欄が空なら400。出すと提出済み', async ({ as }) => {
    const c = await as('sato');
    expect((await c.post(url('/api/profile/year-end/submit'))).status()).toBe(409);
    await c.put(url('/api/profile/year-end'), { data: form({ spouse: person({ name: '', income_estimate: null }) }) });
    const no = await c.post(url('/api/profile/year-end/submit'));
    expect(no.status()).toBe(400);
    expect(await no.json()).toMatchObject({ error: 'incomplete', fields: ['spouse.name', 'spouse.income_estimate'] });
    await c.put(url('/api/profile/year-end'), { data: form() });
    const ok = await c.post(url('/api/profile/year-end/submit'));
    expect(ok.status()).toBe(200);
    expect((await ok.json()).status).toBe('submitted');
    expect((await db.year_end_declarations.findFirstOrThrow({ where: { user_id: USERS.sato.id } })).submitted_at).not.toBeNull();
  });

  test('提出したあとで直すと、下書きに戻る（もう一度出してもらう）', async ({ as }) => {
    const c = await as('sato');
    await c.put(url('/api/profile/year-end'), { data: form() });
    await c.post(url('/api/profile/year-end/submit'));
    const put = await c.put(url('/api/profile/year-end'), { data: form({ note: '子が生まれました' }) });
    expect((await put.json()).status).toBe('draft');
    expect((await db.year_end_declarations.findFirstOrThrow({ where: { user_id: USERS.sato.id } })).submitted_at).toBeNull();
  });

  test('業務委託・準業務委託・派遣は対象外（画面には出ない）。役員は出す', async ({ as }) => {
    const c = await as('suzuki');
    expect(await (await c.get('/api/profile/year-end')).json()).toEqual({ applicable: false });
    expect((await c.put(url('/api/profile/year-end'), { data: form() })).status()).toBe(403);
    expect((await c.post(url('/api/profile/year-end/submit'))).status()).toBe(403);
    expect((await (await (await as('yamada')).get('/api/profile/year-end')).json()).applicable).toBe(true);
  });

  test('ログインしていなければ使えない', async ({ anon }) => {
    expect((await anon.get('/api/profile/year-end', { maxRedirects: 0 })).status()).not.toBe(200);
    expect((await anon.get('/api/year-end', { maxRedirects: 0 })).status()).not.toBe(200);
  });
});

test.describe('年末調整（経理・人事）', () => {
  test('一般の人は一覧も、CSVも、確認もできない', async ({ as }) => {
    const c = await as('sato');
    expect((await c.get(url('/api/year-end'))).status()).toBe(403);
    expect((await c.get(url('/api/year-end/export'))).status()).toBe(403);
    expect((await c.post(`/api/year-end/${USERS.sato.id}/confirm`, { data: { year: YEAR, version: 'x' } })).status()).toBe(403);
  });

  test('経理・人事・管理者は見られる。対象の人は、未入力でも一覧に出る（業務委託は出ない）', async ({ as }) => {
    await (await as('sato')).put(url('/api/profile/year-end'), { data: form() });
    await db.users.update({ where: { id: USERS.tanaka.id }, data: { is_hr: true } });
    for (const who of ['keiri', 'tanaka', 'admin'] as const) {
      const res = await (await as(who)).get(url('/api/year-end'));
      expect(res.status(), who).toBe(200);
      const { items } = await res.json();
      const by = Object.fromEntries(items.map((i: { user: { id: string } }) => [i.user.id, i]));
      expect(by[USERS.sato.id].status).toBe('draft');
      expect(by[USERS.sato.id].data.spouse.name).toBe('佐藤花子');
      expect(by[USERS.tanaka.id].status).toBe('none');
      expect(by[USERS.suzuki.id]).toBeUndefined();
    }
    const log = await db.audit_logs.findFirstOrThrow({ where: { action_type: 'year_end_list_view' }, orderBy: { created_at: 'desc' } });
    expect(log.metadata_json).not.toContain('佐藤');
  });

  test('確認: 提出済みだけ。本人が直したあとの古い画面では確認できない（409）', async ({ as }) => {
    const sato = await as('sato'); const keiri = await as('keiri');
    await sato.put(url('/api/profile/year-end'), { data: form() });
    const draft = (await (await keiri.get(url('/api/year-end'))).json()).items.find((i: { user: { id: string } }) => i.user.id === USERS.sato.id);
    expect((await keiri.post(`/api/year-end/${USERS.sato.id}/confirm`, { data: { year: YEAR, version: draft.version } })).status()).toBe(409);

    await sato.post(url('/api/profile/year-end/submit'));
    const seen = (await (await keiri.get(url('/api/year-end'))).json()).items.find((i: { user: { id: string } }) => i.user.id === USERS.sato.id);
    expect(seen.status).toBe('submitted');
    await sato.put(url('/api/profile/year-end'), { data: form({ note: '直しました' }) });
    await sato.post(url('/api/profile/year-end/submit'));
    const stale = await keiri.post(`/api/year-end/${USERS.sato.id}/confirm`, { data: { year: YEAR, version: seen.version } });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).error).toBe('changed');

    const fresh = (await (await keiri.get(url('/api/year-end'))).json()).items.find((i: { user: { id: string } }) => i.user.id === USERS.sato.id);
    expect((await keiri.post(`/api/year-end/${USERS.sato.id}/confirm`, { data: { year: YEAR, version: fresh.version } })).status()).toBe(200);
    const row = await db.year_end_declarations.findFirstOrThrow({ where: { user_id: USERS.sato.id } });
    expect(row).toMatchObject({ status: 'confirmed', confirmed_by_id: USERS.keiri.id });
    expect(row.confirmed_at).not.toBeNull();
    // after being confirmed, a change from the owner needs a fresh look
    await sato.put(url('/api/profile/year-end'), { data: form({ note: 'また直しました' }) });
    expect(await db.year_end_declarations.findFirstOrThrow({ where: { user_id: USERS.sato.id } })).toMatchObject({ status: 'draft', confirmed_at: null, confirmed_by_id: null });
  });

  test('CSV: BOM付きで、提出した人の内容と、未入力の人が並ぶ。出力は記録に残る', async ({ as }) => {
    await (await as('sato')).put(url('/api/profile/year-end'), { data: form({ note: '=SUM(A1)' }) });
    const keiri = await as('keiri');
    expect((await keiri.get('/api/year-end/export')).status()).toBe(400); // the year is required
    const ok = await keiri.get(url('/api/year-end/export'));
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toContain('text/csv');
    expect(ok.headers()['content-disposition']).toContain(`year-end-${YEAR}.csv`);
    const text = await ok.text();
    expect(text.startsWith('﻿氏名,区分,状態')).toBe(true);
    expect(text).toContain('佐藤,従業員,下書き');
    expect(text).toContain('子: 佐藤一郎（2015-03-03');
    expect(text).toContain("'=SUM(A1)");
    expect(text).toContain('田中,従業員,未入力');
    expect(text).not.toContain('鈴木');
    expect(await db.audit_logs.count({ where: { action_type: 'year_end_export', actor_user_id: USERS.keiri.id } })).toBe(1);
  });
});

test.describe('年末調整（画面）', () => {
  test('プロフィールで、配偶者・扶養親族・控除を入れて保存→提出できる。目安も出る', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/profile');
    await page.getByRole('button', { name: /^年末調整/ }).first().click();
    const card = page.getByRole('region', { name: '年末調整' });
    await expect(card.getByTestId('year-end-status')).toHaveText('未入力');
    await expect(card.getByRole('button', { name: '提出する' })).toBeDisabled();

    await card.getByLabel('配偶者がいる').check();
    await card.locator('#ye-sp-name').fill('佐藤花子');
    await card.locator('#ye-sp-birth').fill('1990-04-01');
    await card.locator('#ye-sp-income').fill('400000');
    await expect(card.getByText('目安: 配偶者控除の対象になる可能性があります')).toBeVisible();

    await card.getByRole('button', { name: '＋ 扶養親族を追加' }).click();
    const dep = card.getByRole('group', { name: '扶養親族 1' });
    await dep.locator('#ye-dep0-name').fill('佐藤一郎');
    await dep.locator('#ye-dep0-birth').fill(`${YEAR - 10}-03-03`);
    await dep.locator('#ye-dep0-income').fill('0');
    await expect(dep.getByText(/16歳未満/)).toBeVisible();
    await card.locator('#ye-life').fill('60,000円');
    await expect(card.locator('#ye-life')).toHaveValue('60000');

    await card.getByRole('button', { name: '下書きを保存' }).click();
    await expect(page.getByText('下書きとして保存しました')).toBeVisible();
    await expect(card.getByTestId('year-end-status')).toHaveText('下書き');
    await card.getByRole('button', { name: '提出する' }).click();
    await expect(page.getByText('提出しました')).toBeVisible();
    await expect(card.getByTestId('year-end-status')).toHaveText('提出済み');
    const row = await db.year_end_declarations.findFirstOrThrow({ where: { user_id: USERS.sato.id } });
    expect(row.status).toBe('submitted');

    // reloading shows what was saved
    await page.reload();
    await page.getByRole('button', { name: /^年末調整/ }).first().click();
    await expect(page.locator('#ye-sp-name')).toHaveValue('佐藤花子');
    await expect(page.locator('#ye-life')).toHaveValue('60000');
    await ctx.close();
  });

  test('家族の欄が空のまま提出すると、足りない項目を教える', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/profile');
    await page.getByRole('button', { name: /^年末調整/ }).first().click();
    const card = page.getByRole('region', { name: '年末調整' });
    await card.getByLabel('配偶者がいる').check();
    await card.getByRole('button', { name: '下書きを保存' }).click();
    await expect(page.getByText('下書きとして保存しました')).toBeVisible();
    await card.getByRole('button', { name: '提出する' }).click();
    await expect(page.getByText(/未入力があります（氏名・生年月日・所得の見込み）/)).toBeVisible();
    await ctx.close();
  });

  test('業務委託の人のプロフィールには出ない', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.suzuki, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/profile');
    await expect(page.getByRole('region', { name: '個人情報' })).toBeVisible();
    await expect(page.getByRole('region', { name: '年末調整' })).toHaveCount(0);
    await ctx.close();
  });

  test('経理: 組織の「年末調整」で、提出された内容を見て確認済みにできる。一般の人にはタブが出ない', async ({ browser, as }) => {
    const sato = await as('sato');
    await sato.put(url('/api/profile/year-end'), { data: form() });
    await sato.post(url('/api/profile/year-end/submit'));

    const ctx = await browser.newContext({ storageState: AUTH.keiri, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/org');
    await page.getByRole('button', { name: '年末調整', exact: true }).click();
    await expect(page.getByTestId('year-end-counts')).toContainText('提出済み');
    const row = page.getByRole('button', { name: /佐藤/ });
    await expect(row).toContainText('提出済み');
    await row.click();
    await expect(page.getByText('配偶者: 佐藤花子')).toBeVisible();
    await expect(page.getByText('目安: 配偶者控除の対象になる可能性があります')).toBeVisible();
    await page.getByRole('button', { name: '確認済みにする' }).click();
    await expect(page.getByText('佐藤さんの分を確認済みにしました')).toBeVisible();
    await expect(page.getByRole('button', { name: /佐藤/ })).toContainText('確認済み');
    await expect(page.getByRole('link', { name: 'CSVでダウンロード' })).toHaveAttribute('href', `/api/year-end/export?year=${YEAR}`);
    await ctx.close();

    const ctx2 = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP' });
    const p2 = await ctx2.newPage();
    await p2.goto('/org');
    await expect(p2.getByRole('heading', { name: '組織' })).toBeVisible();
    await expect(p2.getByRole('button', { name: '年末調整', exact: true })).toHaveCount(0);
    await ctx2.close();
  });
});
