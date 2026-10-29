import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { buildOrg, openCycle, putMemberships } from './helpers/org';
import { makeClaim } from './helpers/factories';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications, resetOrg, setWorkerType } from './helpers/seed';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await resetOrg(); await setWorkerType(USERS.yamada.id, 'executive'); });
test.beforeEach(async () => { await setWorkerType(USERS.yamada.id, 'employee'); /* a 役員's requests are decided by other 役員, not by the 部署 */ await resetOrg(); await clearNotifications(); await mm.reset(); });

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

  test('部門を選んでいない申請（以前の申請）の承認待ちは、本人のどの部署の承認者にも出る', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    await claim('tanaka');
    const list = async (r: 'sato' | 'yamada') => (await (await (await as(r)).get('/api/approvals')).json()).expenses.map((e: { user: { name: string } }) => e.user.name);
    expect(await list('sato')).toEqual(['田中']);
    expect(await list('yamada')).toEqual(['田中']);
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

test.describe('経費申請で、所属する部門を選ぶ', () => {
  const apply = (c: import('@playwright/test').APIRequestContext, over: Record<string, string> = {}) =>
    c.post('/api/expenses', { multipart: { expense_date: '2026-10-20', category: '交通費', title: `部門の経費${Math.random().toString(36).slice(2, 7)}`, amount: '1200', payment_method: 'personal', ...over } });
  const review = (c: Promise<import('@playwright/test').APIRequestContext>, id: string) => c.then(x => x.post(`/api/expenses/${id}/review`, { data: { action: 'approve', comment: 'x' } }));

  test('自分が所属する部門を選んで申請でき、選んだ部門が申請に残る。所属していない部門は選べない', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    const c = await as('tanaka');
    const ok = await apply(c, { unit_id: org.dev });
    expect(ok.status()).toBe(201);
    expect((await db.expense_claims.findUniqueOrThrow({ where: { id: (await ok.json()).id } })).unit_id).toBe(org.dev);
    const mine = (await (await c.get('/api/expenses')).json()).items[0];
    expect(mine.unit).toMatchObject({ id: org.dev, name: '開発部' });
    const bad = await apply(c, { unit_id: org.headquarters });                 // 本社には所属していない
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe('invalid_unit');
  });

  test('2つ以上の部門に所属する人は、部門を選ばないと申請できない。1つだけなら、その部門が自動で入る。どこにも所属しなければ部門なし', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    await putMemberships(admin, USERS.tanaka.id, [{ unit_id: org.sales, position_id: null }, { unit_id: org.dev, position_id: null }]);
    const no = await apply(await as('tanaka'));
    expect(no.status()).toBe(400);
    expect((await no.json()).error).toBe('unit_required');
    const one = await apply(await as('sato'));                                   // 佐藤は営業部だけ
    expect((await db.expense_claims.findUniqueOrThrow({ where: { id: (await one.json()).id } })).unit_id).toBe(org.sales);
    const none = await apply(await as('guest'));                                 // どの部門にも所属しない
    expect(none.status()).toBe(201);
    expect((await db.expense_claims.findUniqueOrThrow({ where: { id: (await none.json()).id } })).unit_id).toBeNull();
  });

  test('承認は、選んだ部門の承認者だけ。ほかの部門の承認者（兼務先でも）は承認できない。一覧・通知も選んだ部門だけ', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    const c = await as('tanaka');
    const forDev = await (await apply(c, { unit_id: org.dev, title: '開発部の経費' })).json();
    const list = async (r: 'sato' | 'yamada') => (await (await (await as(r)).get('/api/approvals')).json()).expenses.map((e: { title: string; unit: { name: string } }) => `${e.title}/${e.unit.name}`);
    expect(await list('yamada')).toEqual(['開発部の経費/開発部']);
    expect(await list('sato')).toEqual([]);                                      // 営業部の課長には出ない
    expect((await review(as('sato'), forDev.id)).status()).toBe(403);
    expect((await review(as('yamada'), forDev.id)).status()).toBe(200);
    const posts = await mm.waitFor(p => p.message.includes('開発部の経費'));
    expect(posts.map(p => p.to).sort()).toEqual(['mm-admin', 'mm-admin2', 'mm-yamada']);   // 営業部の佐藤には届かない
    expect(posts[0].message).toContain('部門: 開発部');
  });

  test('部門を後から変えられる（承認前・却下後）。変えると、承認者も変わる', async ({ as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: null }, { unit_id: org.dev, position_id: null }]);
    const c = await as('tanaka');
    const claim = await (await apply(c, { unit_id: org.sales })).json();
    const patch = (data: object) => c.patch(`/api/expenses/${claim.id}`, { data: { expense_date: '2026-10-20', category: '交通費', title: 'x', amount: 1200, payment_method: 'personal', ...data } });
    expect((await patch({ unit_id: org.dev })).status()).toBe(200);
    expect((await db.expense_claims.findUniqueOrThrow({ where: { id: claim.id } })).unit_id).toBe(org.dev);
    expect((await review(as('sato'), claim.id)).status()).toBe(403);
    expect((await patch({ unit_id: org.headquarters })).status()).toBe(400);
    expect((await patch({})).status()).toBe(200);                                // not sent = as it was
    expect((await db.expense_claims.findUniqueOrThrow({ where: { id: claim.id } })).unit_id).toBe(org.dev);
  });

  test('画面: 申請フォームに「部門」があり、2つ以上なら選べる。申請の一覧と詳細にも部門が出る', async ({ browser, as }) => {
    const org = await buildOrg(as);
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    const ctx = await browser.newContext({ storageState: AUTH.tanaka, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    const sel = page.getByLabel('部門', { exact: true });
    await expect(sel).toBeVisible();
    await expect(sel.locator('option')).toHaveText(['営業部（メンバー）', '開発部（メンバー）']);
    await expect(page.getByText('選んだ部門の承認者が承認します')).toBeVisible();
    await sel.selectOption({ label: '開発部（メンバー）' });
    await page.getByPlaceholder(/A社訪問/).fill('開発部の交通費');
    await page.locator('input[type=number]').first().fill('800');
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('申請しました')).toBeVisible();
    expect((await db.expense_claims.findFirstOrThrow({ where: { user_id: USERS.tanaka.id } })).unit_id).toBe(org.dev);
    await page.getByRole('button', { name: /開発部の交通費/ }).click();
    await expect(page.getByText('部門: 開発部（この部門の承認者が承認します）')).toBeVisible();
    await ctx.close();
    // the approver sees which 部門 it is for
    const yctx = await browser.newContext({ storageState: AUTH.yamada, locale: 'ja-JP' });
    const yp = await yctx.newPage();
    await yp.goto('/approvals');
    await expect(yp.getByText('田中 ・ 開発部')).toBeVisible();
    await yctx.close();
  });
});
