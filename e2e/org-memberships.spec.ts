import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { buildOrg, openCycle, putMemberships } from './helpers/org';
import { makeClaim } from './helpers/factories';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications, resetOrg } from './helpers/seed';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await resetOrg(); });
test.beforeEach(async () => { await resetOrg(); await clearNotifications(); await mm.reset(); });

const rows = (userId: string) => db.org_memberships.findMany({ where: { user_id: userId }, orderBy: { unit_id: 'asc' } });

test.describe('部署ごとに役職をつけて、何個でも所属できる', () => {
  test('1人を複数の部署に、部署ごとに別の役職で入れられる。一覧にもそのまま出る', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    await putMemberships(admin, USERS.tanaka.id, [
      { unit_id: org.sales, position_id: org.positions['チームリーダー'] },       // 営業部では班長
      { unit_id: org.dev, position_id: org.positions['部長'] },                    // 開発部では部長
      { unit_id: org.headquarters, position_id: null },                            // 本社では役職なし
    ]);
    const found = await rows(USERS.tanaka.id);
    expect(found).toHaveLength(3);
    expect(Object.fromEntries(found.map(r => [r.unit_id, r.position_id]))).toEqual({ [org.sales]: org.positions['チームリーダー'], [org.dev]: org.positions['部長'], [org.headquarters]: null });
    const listed = (await (await (await as('suzuki')).get('/api/org')).json()).members.find((m: { id: string }) => m.id === USERS.tanaka.id);
    expect(listed.memberships).toHaveLength(3);
    expect(listed.can_evaluate).toBe(true);
  });

  test('保存は「全部入れ替え」。空にすると、どの部署にも所属しなくなる。変更は監査ログに残る', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    await putMemberships(admin, USERS.tanaka.id, [{ unit_id: org.sales, position_id: null }, { unit_id: org.dev, position_id: null }]);
    await putMemberships(admin, USERS.tanaka.id, [{ unit_id: org.dev, position_id: org.positions['課長'] }]);
    expect((await rows(USERS.tanaka.id)).map(r => r.unit_id)).toEqual([org.dev]);
    await putMemberships(admin, USERS.tanaka.id, []);
    expect(await rows(USERS.tanaka.id)).toEqual([]);
    const log = await db.audit_logs.findFirstOrThrow({ where: { action_type: 'org_member_update', target_id: USERS.tanaka.id }, orderBy: { created_at: 'desc' } });
    expect(JSON.parse(log.metadata_json)).toMatchObject({ to: [] });
  });

  test('21か所以上は登録できない。管理者以外は変えられない', async ({ as }) => {
    const org = await buildOrg(as);
    const many = Array.from({ length: 21 }, (_, i) => ({ unit_id: `u${i}`, position_id: null }));
    expect((await (await as('admin')).put(`/api/org/members/${USERS.tanaka.id}`, { data: { memberships: many } })).status()).toBe(400);
    expect((await (await as('sato')).put(`/api/org/members/${USERS.tanaka.id}`, { data: { memberships: [{ unit_id: org.dev, position_id: null }] } })).status()).toBe(403);
  });

  test('役職を消しても所属は残る（役職なしになる）。部署を消すと、その部署の所属だけが消える', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    await putMemberships(admin, USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['課長'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    await admin.delete(`/api/org/positions/${org.positions['課長']}`);
    expect(Object.fromEntries((await rows(USERS.tanaka.id)).map(r => [r.unit_id, r.position_id]))).toEqual({ [org.sales]: null, [org.dev]: org.positions['メンバー'] });
    expect((await admin.delete(`/api/org/units/${org.dev}`)).status()).toBe(200);
    expect((await rows(USERS.tanaka.id)).map(r => r.unit_id)).toEqual([org.sales]);
  });
});

test.describe('承認は部署ごと', () => {
  const claim = (role: 'tanaka' | 'sato' | 'yamada') => makeClaim({ role, status: 'pending', title: `${role}の経費` });
  const review = (c: Promise<import('@playwright/test').APIRequestContext>, id: string) => c.then(x => x.post(`/api/expenses/${id}/review`, { data: { action: 'approve', comment: 'x' } }));

  test('2つの部署に所属する人の申請は、どちらの部署の承認者も承認できる（先に処理した方で完了）', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    const c = await claim('tanaka');
    expect((await review(as('yamada'), c.id)).status()).toBe(200);     // 開発部の部長
    const d = await claim('tanaka');
    expect((await review(as('sato'), d.id)).status()).toBe(200);       // 営業部の課長
  });

  test('承認待ちの一覧は、それぞれの部署の承認者に出る。申請の通知も両方の承認者に届く', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    await claim('tanaka');
    const list = async (r: 'sato' | 'yamada') => (await (await (await as(r)).get('/api/approvals')).json()).expenses.map((e: { user: { name: string } }) => e.user.name);
    expect(await list('sato')).toEqual(['田中']);
    expect(await list('yamada')).toEqual(['田中']);
    const res = await (await as('tanaka')).post('/api/expenses', { multipart: { expense_date: '2026-10-20', category: '交通費', title: '2部署の通知', amount: '1200', payment_method: 'personal' } });
    expect(res.status()).toBe(201);
    const posts = await mm.waitFor(p => p.message.includes('2部署の通知'));
    expect(posts.map(p => p.to).sort()).toEqual(['mm-admin', 'mm-admin2', 'mm-sato', 'mm-yamada']);
  });

  test('承認者の役職が部署ごとに違うとき、権限のある部署の人だけ承認できる（田中: 営業部ではメンバー、開発部では課長）', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['課長'] }]);
    const inSales = await claim('sato');
    const inDev = await claim('yamada');
    expect((await review(as('tanaka'), inSales.id)).status()).toBe(403);
    expect((await review(as('tanaka'), inDev.id)).status()).toBe(200);
  });
});

test.describe('人事評価は部署ごと（評価者も部署ごと）', () => {
  const forms = async (as: (r: any) => Promise<import('@playwright/test').APIRequestContext>, cycleId: string, userId: string) => {
    const items = (await (await (await as('keiri')).get(`/api/evaluations?scope=all&cycle_id=${cycleId}`)).json()).items as { id: string; user: { id: string }; unit: { name: string } | null; evaluator: { name: string } | null }[];
    return items.filter(i => i.user.id === userId);
  };

  test('2つの部署に所属する人には、評価票が部署ごとに1枚ずつできて、評価者はそれぞれの部署で決まる', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['チームリーダー'] }]);
    const cycle = await openCycle(await as('keiri'));
    const mine = await forms(as, cycle, USERS.tanaka.id);
    expect(mine.map(f => [f.unit?.name, f.evaluator?.name]).sort()).toEqual([['営業部', '佐藤'], ['開発部', '山田']]);
    // ...and each evaluator sees only the form of their own 部署
    const team = async (r: 'sato' | 'yamada') => ((await (await (await as(r)).get(`/api/evaluations?scope=team&cycle_id=${cycle}`)).json()).items as { user: { name: string }; unit: { name: string } }[]).filter(i => i.user.name === '田中').map(i => i.unit.name);
    expect(await team('sato')).toEqual(['営業部']);
    expect(await team('yamada')).toEqual(['開発部']);
  });

  test('本人には2枚とも見える（自己評価も部署ごと）。1部署の人は1枚、どの部署にもいない人は評価者なしの1枚', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    const cycle = await openCycle(await as('keiri'));
    const mine = ((await (await (await as('tanaka')).get(`/api/evaluations?scope=mine&cycle_id=${cycle}`)).json()).items) as { unit: { name: string } }[];
    expect(mine.map(f => f.unit.name).sort()).toEqual(['営業部', '開発部']);
    expect(await forms(as, cycle, USERS.suzuki.id)).toHaveLength(1);
    const guest = await forms(as, cycle, USERS.guest.id);
    expect(guest).toHaveLength(1);
    expect(guest[0]).toMatchObject({ unit: null, evaluator: null });
  });

  test('評価の開始を2回しても、評価票は増えない', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: null }, { unit_id: org.dev, position_id: null }]);
    const keiri = await as('keiri');
    const cycle = await openCycle(keiri);
    const before = await db.evaluations.count({ where: { cycle_id: cycle } });
    expect((await keiri.post(`/api/evaluations/cycles/${cycle}/open`)).status()).toBeLessThan(500);
    expect(await db.evaluations.count({ where: { cycle_id: cycle } })).toBe(before);
  });
});

test.describe('画面: 部署のタブで、人を入れて役職をつける', () => {
  test('部署に人を追加し、役職を変え、外せる。同じ人を別の部署に別の役職で入れられる。組織図にも出る', async ({ browser, as }) => {
    const org = await buildOrg(as);
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/org');
    await page.getByRole('button', { name: '部署', exact: true }).click();
    const dev = page.getByRole('listitem', { name: '開発部' });
    await dev.getByLabel('開発部に入れる人').selectOption({ label: '田中' });
    await dev.getByLabel('開発部での役職').selectOption({ label: '課長' });
    await dev.getByRole('button', { name: '＋ 追加' }).click();
    await expect(page.getByText('田中 さんを更新しました')).toBeVisible();
    expect(Object.fromEntries((await rows(USERS.tanaka.id)).map(r => [r.unit_id, r.position_id]))).toEqual({ [org.sales]: org.positions['メンバー'], [org.dev]: org.positions['課長'] });
    // change the 役職 there
    await dev.getByLabel('開発部での田中の役職').selectOption({ label: 'チームリーダー' });
    await expect.poll(async () => (await rows(USERS.tanaka.id)).find(r => r.unit_id === org.dev)?.position_id).toBe(org.positions['チームリーダー']);
    // the chart lists 田中 under both
    await page.getByRole('button', { name: '組織図' }).click();
    await expect(page.getByRole('region', { name: '営業部' })).toContainText('田中');
    await expect(page.getByRole('region', { name: '開発部' })).toContainText('田中チームリーダー');
    // take him out of 開発部 again
    await page.getByRole('button', { name: '部署', exact: true }).click();
    await page.getByRole('button', { name: '田中を開発部から外す' }).click();
    await expect.poll(async () => (await rows(USERS.tanaka.id)).map(r => r.unit_id)).toEqual([org.sales]);
    await ctx.close();
  });
});
