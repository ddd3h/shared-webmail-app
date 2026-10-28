import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { buildOrg } from './helpers/org';
import { makeClaim } from './helpers/factories';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications, resetOrg } from './helpers/seed';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await resetOrg(); });
test.beforeEach(async () => { await resetOrg(); await clearNotifications(); await mm.reset(); });

// 田中: 主所属は営業部、開発部を兼務
const put = (admin: import('@playwright/test').APIRequestContext, userId: string, data: object) => admin.put(`/api/org/members/${userId}`, { data });
const extraOf = async (userId: string) => (await db.org_unit_extra_members.findMany({ where: { user_id: userId } })).map(e => e.unit_id).sort();

test.describe('所属部署を複数にできる（兼務）', () => {
  test('主所属のほかに、兼務の部署を登録できる。組織の一覧にも出る', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    const res = await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: org.positions['メンバー'], extra_unit_ids: [org.dev, org.headquarters] });
    expect(res.status()).toBe(200);
    expect(await extraOf(USERS.tanaka.id)).toEqual([org.dev, org.headquarters].sort());
    expect((await db.users.findUniqueOrThrow({ where: { id: USERS.tanaka.id } })).org_unit_id).toBe(org.sales);
    const listed = (await (await (await as('sato')).get('/api/org')).json()).members.find((m: { id: string }) => m.id === USERS.tanaka.id);
    expect(listed).toMatchObject({ org_unit_id: org.sales });
    expect([...listed.extra_unit_ids].sort()).toEqual([org.dev, org.headquarters].sort());
  });

  test('兼務を送らないときは、今のまま。空の配列で全部外れる。主所属を外すと兼務も消える', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: [org.dev] });
    await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: org.positions['メンバー'] });       // not sent: unchanged
    expect(await extraOf(USERS.tanaka.id)).toEqual([org.dev]);
    await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: [] });
    expect(await extraOf(USERS.tanaka.id)).toEqual([]);
    await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: [org.dev] });
    await put(admin, USERS.tanaka.id, { org_unit_id: null, position_id: null });
    expect(await extraOf(USERS.tanaka.id)).toEqual([]);
  });

  test('主所属と同じ部署は兼務に入らない。同じ部署を2回送っても1つ。存在しない部署・11個は拒否', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    expect((await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: [org.sales, org.dev, org.dev] })).status()).toBe(200);
    expect(await extraOf(USERS.tanaka.id)).toEqual([org.dev]);
    expect((await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: ['nope'] })).status()).toBe(400);
    expect((await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: Array.from({ length: 11 }, (_, i) => `u${i}`) })).status()).toBe(400);
    expect(await extraOf(USERS.tanaka.id)).toEqual([org.dev]);   // a refused change leaves things as they were
  });

  test('主所属を、兼務に入っている部署に変えると、兼務からは外れる', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: [org.dev] });
    await put(admin, USERS.tanaka.id, { org_unit_id: org.dev, position_id: null });
    expect(await extraOf(USERS.tanaka.id)).toEqual([]);
  });

  test('管理者だけが変えられる。変更は監査ログに残る。部署を消すと兼務も消える', async ({ as }) => {
    const org = await buildOrg(as);
    expect((await put(await as('sato'), USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: [org.dev] })).status()).toBe(403);
    const admin = await as('admin');
    await put(admin, USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: [org.dev] });
    const log = await db.audit_logs.findFirstOrThrow({ where: { action_type: 'org_member_update', target_id: USERS.tanaka.id }, orderBy: { created_at: 'desc' } });
    expect(JSON.parse(log.metadata_json).to.extra_unit_ids).toEqual([org.dev]);
    expect((await admin.delete(`/api/org/units/${org.dev}`)).status()).toBe(200);
    expect(await extraOf(USERS.tanaka.id)).toEqual([]);
  });
});

test.describe('兼務と承認', () => {
  const claim = (role: 'tanaka' | 'sato') => makeClaim({ role, status: 'pending', title: `${role}の経費` });
  const review = (c: Promise<import('@playwright/test').APIRequestContext>, id: string) => c.then(x => x.post(`/api/expenses/${id}/review`, { data: { action: 'approve', comment: 'x' } }));

  test('兼務先の部署長も、そのメンバーの申請を承認できる。兼務していない部署長は承認できない', async ({ as }) => {
    const org = await buildOrg(as);
    await put(await as('admin'), USERS.tanaka.id, { org_unit_id: org.sales, position_id: org.positions['メンバー'], extra_unit_ids: [org.dev] });
    const c = await claim('tanaka');
    // 開発部の部長（山田）: 田中は開発部を兼務している
    expect((await review(as('yamada'), c.id)).status()).toBe(200);
    // for comparison: before the 兼務 yamada could not
    await db.expense_claims.update({ where: { id: c.id }, data: { status: 'pending', reviewed_by_id: null } });
    await put(await as('admin'), USERS.tanaka.id, { org_unit_id: org.sales, position_id: null, extra_unit_ids: [] });
    expect((await review(as('yamada'), c.id)).status()).toBe(403);
  });

  test('承認待ちの一覧には、兼務先の部署長にも出る。申請の通知も兼務先の部署長に届く', async ({ as }) => {
    const org = await buildOrg(as);
    await put(await as('admin'), USERS.tanaka.id, { org_unit_id: org.sales, position_id: org.positions['メンバー'], extra_unit_ids: [org.dev] });
    await claim('tanaka');
    const list = async (r: 'sato' | 'yamada') => (await (await (await as(r)).get('/api/approvals')).json()).expenses.map((e: { user: { name: string } }) => e.user.name);
    expect(await list('sato')).toEqual(['田中']);
    expect(await list('yamada')).toEqual(['田中']);
    const res = await (await as('tanaka')).post('/api/expenses', { multipart: { expense_date: '2026-10-20', category: '交通費', title: '兼務の通知', amount: '1200', payment_method: 'personal' } });
    expect(res.status()).toBe(201);
    const posts = await mm.waitFor(p => p.message.includes('兼務の通知'));
    expect(posts.map(p => p.to).sort()).toEqual(['mm-admin', 'mm-admin2', 'mm-sato', 'mm-yamada']);
  });

  test('本人は、自分の申請を承認できない（兼務していても）', async ({ as }) => {
    const org = await buildOrg(as);
    await put(await as('admin'), USERS.sato.id, { org_unit_id: org.sales, position_id: org.positions['課長'], extra_unit_ids: [org.dev] });
    const c = await claim('sato');
    expect((await review(as('sato'), c.id)).status()).toBe(403);
  });
});

test.describe('兼務（画面）', () => {
  test('管理者が「兼務」を選ぶと保存され、組織図の両方の部署に「兼務」つきで出る。プロフィールにも出る', async ({ browser, as }) => {
    const org = await buildOrg(as);
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/org');
    await page.getByRole('button', { name: 'メンバー配置' }).click();
    await page.getByLabel('田中の兼務').click();
    await page.getByRole('checkbox', { name: '開発部' }).check();
    await expect(page.getByText('田中 さんを更新しました')).toBeVisible();
    expect(await extraOf(USERS.tanaka.id)).toEqual([org.dev]);
    await expect(page.getByLabel('田中の兼務')).toContainText('開発部');
    await page.getByRole('button', { name: '組織図' }).click();
    await expect(page.getByRole('region', { name: '営業部' }).getByText('田中')).toBeVisible();
    const dev = page.getByRole('region', { name: '開発部' });
    await expect(dev.getByText('田中')).toBeVisible();
    await expect(dev.getByText('兼務')).toBeVisible();
    await ctx.close();

    const t = await browser.newContext({ storageState: AUTH.tanaka, locale: 'ja-JP' });
    const p2 = await t.newPage();
    await p2.goto('/profile');
    await expect(p2.getByText('営業部、開発部（兼務）')).toBeVisible();
    await t.close();
  });
});
