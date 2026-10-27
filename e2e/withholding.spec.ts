import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { today } from './helpers/ui';

test.describe.configure({ mode: 'serial' });
const YEAR = Number(today().slice(0, 4));
const reset = async () => { await db.users.updateMany({ data: { withholding_class: 'ko' } }); await db.year_end_declarations.deleteMany(); await db.payslips.deleteMany(); };
test.beforeEach(reset);
test.afterAll(reset);

const cls = async (id: string) => (await db.users.findUniqueOrThrow({ where: { id } })).withholding_class;

test.describe('源泉徴収の欄（甲欄・乙欄）', () => {
  test('はじめは全員、甲欄', async () => {
    expect(await cls(USERS.sato.id)).toBe('ko');
  });

  test('管理者・経理は、ユーザーごとに甲欄・乙欄を選べる。変更は監査ログに残る', async ({ as }) => {
    for (const who of ['admin', 'keiri'] as const) {
      const c = await as(who);
      expect((await c.patch(`/api/work/users/${USERS.sato.id}`, { data: { withholding_class: 'otsu' } })).status(), who).toBe(200);
      expect(await cls(USERS.sato.id)).toBe('otsu');
      expect((await c.patch(`/api/work/users/${USERS.sato.id}`, { data: { withholding_class: 'ko' } })).status()).toBe(200);
      expect(await cls(USERS.sato.id)).toBe('ko');
    }
    const logs = await db.audit_logs.findMany({ where: { action_type: 'withholding_class_update', target_id: USERS.sato.id } });
    expect(logs.length).toBe(4);
    expect(JSON.parse(logs[0].metadata_json)).toEqual({ from: 'ko', to: 'otsu' });
    // a second user is not touched
    expect(await cls(USERS.tanaka.id)).toBe('ko');
  });

  test('甲・乙以外の値は400。一般の人は変えられない。経理は区分や権限までは変えられない', async ({ as }) => {
    expect((await (await as('keiri')).patch(`/api/work/users/${USERS.sato.id}`, { data: { withholding_class: 'hei' } })).status()).toBe(400);
    expect((await (await as('sato')).patch(`/api/work/users/${USERS.sato.id}`, { data: { withholding_class: 'otsu' } })).status()).toBe(403);
    const keiri = await as('keiri');
    expect((await keiri.patch(`/api/work/users/${USERS.sato.id}`, { data: { worker_type: 'part' } })).status()).toBe(403);
    expect((await keiri.patch(`/api/work/users/${USERS.sato.id}`, { data: { is_hr: true } })).status()).toBe(403);
    expect((await keiri.patch(`/api/work/users/${USERS.sato.id}`, { data: { withholding_class: 'otsu', is_hr: true } })).status()).toBe(403);
    expect(await cls(USERS.sato.id)).toBe('ko');
  });

  test('一覧と本人のプロフィールに出る（給与をもらう人だけ）', async ({ as }) => {
    await db.users.update({ where: { id: USERS.sato.id }, data: { withholding_class: 'otsu' } });
    const items = (await (await (await as('keiri')).get('/api/work/users')).json()).items as { id: string; withholding_class: string }[];
    expect(items.find(i => i.id === USERS.sato.id)!.withholding_class).toBe('otsu');
    expect((await (await (await as('sato')).get('/api/profile/info')).json()).withholding).toBe('乙欄');
    expect((await (await (await as('tanaka')).get('/api/profile/info')).json()).withholding).toBe('甲欄');
    expect((await (await (await as('suzuki')).get('/api/profile/info')).json()).withholding).toBeNull(); // 業務委託
  });

  test('乙欄の人は年末調整の対象外（入力欄も、組織の一覧にも出ない）。甲欄に戻すと出る', async ({ as }) => {
    await db.users.update({ where: { id: USERS.sato.id }, data: { withholding_class: 'otsu' } });
    const sato = await as('sato');
    expect(await (await sato.get('/api/profile/year-end')).json()).toEqual({ applicable: false });
    expect((await sato.post(`/api/profile/year-end/submit?year=${YEAR}`)).status()).toBe(403);
    const { items } = await (await (await as('keiri')).get(`/api/year-end?year=${YEAR}`)).json();
    expect(items.find((i: { user: { id: string } }) => i.user.id === USERS.sato.id)).toBeUndefined();
    await db.users.update({ where: { id: USERS.sato.id }, data: { withholding_class: 'ko' } });
    expect((await (await sato.get('/api/profile/year-end')).json()).applicable).toBe(true);
  });

  test('画面: 給与の明細を登録するとき、その人の欄を選べて、所得税の行の名前も変わる', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.keiri, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await page.getByRole('button', { name: '管理' }).click();
    await page.getByRole('button', { name: '給与・報酬の管理' }).click();
    await page.getByRole('button', { name: '＋ 明細を登録' }).click();
    const dlg = page.getByRole('dialog', { name: '明細を登録' });
    await dlg.getByLabel('対象者').selectOption(USERS.sato.id);
    await expect(dlg.getByLabel('源泉徴収（所得税）の欄')).toHaveValue('ko');
    await expect(dlg.locator('input[value="所得税（甲欄）"]')).toBeVisible();
    await dlg.getByLabel('源泉徴収（所得税）の欄').selectOption('otsu');
    await expect(page.getByText('源泉徴収を乙欄にしました')).toBeVisible();
    await expect(dlg.locator('input[value="所得税（乙欄）"]')).toBeVisible();
    expect(await cls(USERS.sato.id)).toBe('otsu');
    // a different person starts from their own 欄
    await dlg.getByLabel('対象者').selectOption(USERS.tanaka.id);
    await expect(dlg.getByLabel('源泉徴収（所得税）の欄')).toHaveValue('ko');
    await expect(dlg.locator('input[value="所得税（甲欄）"]')).toBeVisible();
    await ctx.close();
  });

  test('画面: 管理画面のメンバー表で、給与の人だけが選べる（業務委託は「—」）', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto('/work');
    await page.getByRole('button', { name: '管理' }).click();
    await page.getByRole('button', { name: '区分・設定' }).click();
    await page.getByLabel('佐藤の源泉徴収').selectOption('otsu');
    await expect(page.getByText('源泉徴収を乙欄にしました（年末調整の対象から外れます）')).toBeVisible();
    expect(await cls(USERS.sato.id)).toBe('otsu');
    await expect(page.getByLabel('鈴木の源泉徴収')).toHaveCount(0);
    await ctx.close();
  });
});
