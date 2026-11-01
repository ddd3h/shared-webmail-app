import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { buildOrg, openCycle } from './helpers/org';
import { postClaim } from './helpers/factories';
import { clearNotifications, resetOrg } from './helpers/seed';

// 部署ごとに、経費の承認者と評価者を指定できる（管理者・人事）。指定がなければ、役職の権限で決まる。
// 営業部: 佐藤(課長)・田中・鈴木。本社: 管理者(部長)・経理(人事)。
test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await resetOrg(); });
test.beforeEach(async () => { await resetOrg(); await clearNotifications(); });

type As = (r: any) => Promise<import('@playwright/test').APIRequestContext>;
const designate = async (as: As, who: 'admin' | 'keiri' | 'sato', unit: string, kind: 'expense' | 'evaluation', roles: ('sato' | 'tanaka' | 'suzuki')[]) =>
  (await as(who)).put(`/api/org/units/${unit}/designations`, { data: { kind, user_ids: roles.map(r => USERS[r].id) } });
const review = (c: Promise<import('@playwright/test').APIRequestContext>, id: string) => c.then(x => x.post(`/api/expenses/${id}/review`, { data: { action: 'approve', comment: 'ok' } }));
const claimOf = async (as: As, unit: string) => (await (await postClaim(await as('tanaka'), { unit_id: unit })).json()).id as string;

test.describe('指定できる人', () => {
  test('管理者と人事（経理担当の人事）は指定できる。ほかの人は403。存在しない部署・人は404・400', async ({ as }) => {
    const org = await buildOrg(as);
    expect((await designate(as, 'sato', org.sales, 'expense', ['suzuki'])).status()).toBe(403);
    expect((await designate(as, 'admin', org.sales, 'expense', ['suzuki'])).status()).toBe(200);
    expect((await designate(as, 'keiri', org.sales, 'evaluation', ['suzuki'])).status()).toBe(200);
    expect((await designate(as, 'admin', 'nope', 'expense', ['suzuki'])).status()).toBe(404);
    expect((await (await as('admin')).put(`/api/org/units/${org.sales}/designations`, { data: { kind: 'expense', user_ids: ['u_nobody'] } })).status()).toBe(400);
    expect((await (await as('admin')).put(`/api/org/units/${org.sales}/designations`, { data: { kind: 'other', user_ids: [] } })).status()).toBe(400);
  });

  test('一覧（/api/org）に出るのは、指定できる人にだけ。順番は指定した順', async ({ as }) => {
    const org = await buildOrg(as);
    await designate(as, 'admin', org.sales, 'evaluation', ['suzuki', 'tanaka']);
    const mine = async (who: 'admin' | 'keiri' | 'sato') => (await (await (await as(who)).get('/api/org')).json());
    expect((await mine('sato')).designations).toEqual([]);
    expect((await mine('sato')).me.can_designate).toBe(false);
    const d = await mine('keiri');
    expect(d.me.can_designate).toBe(true);
    expect(d.designations.map((x: { user_id: string }) => x.user_id)).toEqual([USERS.suzuki.id, USERS.tanaka.id]);
  });
});

test.describe('経費の承認者', () => {
  test('指定した部署の経費は、指定した人（と管理者）だけが承認できる。ふだんの承認者（課長）は承認できなくなる', async ({ as }) => {
    const org = await buildOrg(as);
    const before = await claimOf(as, org.sales);
    expect((await review(as('suzuki'), before)).status()).toBe(403); // メンバーなので、指定がなければ承認できない
    await designate(as, 'admin', org.sales, 'expense', ['suzuki']);
    const id = await claimOf(as, org.sales);
    expect((await review(as('sato'), id)).status()).toBe(403);
    expect((await review(as('suzuki'), id)).status()).toBe(200);
    expect((await review(as('admin'), await claimOf(as, org.sales))).status()).toBe(200);
  });

  test('指定された人は自分の経費は承認できない。指定を外すと、役職の権限に戻る', async ({ as }) => {
    const org = await buildOrg(as);
    await designate(as, 'admin', org.sales, 'expense', ['tanaka', 'suzuki']);
    expect((await review(as('tanaka'), await claimOf(as, org.sales))).status()).toBe(403);
    await designate(as, 'admin', org.sales, 'expense', []);
    expect((await review(as('sato'), await claimOf(as, org.sales))).status()).toBe(200);
    expect((await review(as('suzuki'), await claimOf(as, org.sales))).status()).toBe(403);
  });

  test('ほかの部署の経費には、指定は効かない', async ({ as }) => {
    const org = await buildOrg(as);
    await designate(as, 'admin', org.sales, 'expense', ['suzuki']);
    const { putMemberships } = await import('./helpers/org');
    await putMemberships(await as('admin'), USERS.tanaka.id, [{ unit_id: org.sales, position_id: org.positions['メンバー'] }, { unit_id: org.dev, position_id: org.positions['メンバー'] }]);
    expect((await review(as('yamada'), await claimOf(as, org.dev))).status()).toBe(200); // 開発部は指定なし: 部長のまま
    expect((await review(as('suzuki'), await claimOf(as, org.dev))).status()).toBe(403);
  });

  test('承認待ちの一覧は、指定された人にだけ出る（課長には出ない）。メニューにも「承認」が出る', async ({ as }) => {
    const org = await buildOrg(as);
    await designate(as, 'admin', org.sales, 'expense', ['suzuki']);
    await postClaim(await as('tanaka'), { unit_id: org.sales, title: '指定部署の経費' });
    const titles = async (who: 'sato' | 'suzuki') => ((await (await (await as(who)).get('/api/approvals')).json()).expenses ?? []).map((e: { title: string }) => e.title);
    expect(await titles('sato')).not.toContain('指定部署の経費');
    expect(await titles('suzuki')).toContain('指定部署の経費');
    expect((await (await (await as('suzuki')).get('/api/work/me')).json()).can_approve).toBe(true);
  });

  test('通知は、指定された人に届く（課長には届かない）', async ({ as }) => {
    const org = await buildOrg(as);
    await designate(as, 'admin', org.sales, 'expense', ['suzuki']);
    await postClaim(await as('tanaka'), { unit_id: org.sales, title: '通知の経費' });
    await new Promise(r => setTimeout(r, 1500)); // the notice is sent in the background
    const rows = await db.mattermost_notifications.findMany({ where: { notification_type: 'expense_submitted' } });
    const to = new Set(rows.map(r => r.user_id));
    expect(to.has(USERS.suzuki.id)).toBe(true);
    expect(to.has(USERS.sato.id)).toBe(false);
  });
});

test.describe('評価者', () => {
  const evaluatorOf = async (cycleId: string, role: 'tanaka' | 'suzuki' | 'sato') => (await db.evaluations.findFirstOrThrow({ where: { cycle_id: cycleId, user_id: USERS[role].id } })).evaluator_id;

  test('指定した部署のメンバーの評価者は、指定した人になる。本人の評価は、次に指定した人（いなければ役職のルール）', async ({ as }) => {
    const org = await buildOrg(as);
    await designate(as, 'keiri', org.sales, 'evaluation', ['suzuki']);
    const cycle = await openCycle(await as('keiri'));
    expect(await evaluatorOf(cycle, 'tanaka')).toBe(USERS.suzuki.id);
    expect(await evaluatorOf(cycle, 'sato')).toBe(USERS.suzuki.id);
    expect(await evaluatorOf(cycle, 'suzuki')).toBe(USERS.sato.id); // 本人は評価できない: 役職のルール（課長）
  });

  test('複数指定すると、上の人が評価者。本人の分は次の人', async ({ as }) => {
    const org = await buildOrg(as);
    await designate(as, 'admin', org.sales, 'evaluation', ['suzuki', 'tanaka']);
    const cycle = await openCycle(await as('keiri'));
    expect(await evaluatorOf(cycle, 'sato')).toBe(USERS.suzuki.id);
    expect(await evaluatorOf(cycle, 'suzuki')).toBe(USERS.tanaka.id);
  });

  test('指定がない部署は、これまで通り役職で決まる（課長が評価者）', async ({ as }) => {
    await buildOrg(as);
    const cycle = await openCycle(await as('keiri'));
    expect(await evaluatorOf(cycle, 'tanaka')).toBe(USERS.sato.id);
  });

  test('指定された人は、役職に評価の権限がなくても、人事評価のメニューが出る', async ({ as }) => {
    const org = await buildOrg(as);
    await designate(as, 'admin', org.sales, 'evaluation', ['suzuki']);
    const me = await (await (await as('suzuki')).get('/api/work/me')).json();
    expect(me.is_evaluator).toBe(true);
    void org;
  });
});

test.describe('画面', () => {
  test.use({ storageState: AUTH.keiri });
  test('人事は「承認者・評価者」のタブで、部署ごとに指定でき、外すと元に戻る', async ({ page, as }) => {
    const org = await buildOrg(as);
    await page.goto('/org');
    await page.getByRole('button', { name: '承認者・評価者' }).click();
    const unit = page.getByRole('listitem', { name: '営業部' });
    await expect(unit.getByTestId('designation-expense')).toContainText('指定なし');
    await unit.getByLabel('営業部の経費の承認者に加える人').selectOption({ label: '鈴木' });
    await unit.getByTestId('designation-expense').getByRole('button', { name: /加える/ }).click();
    await expect(unit.getByRole('button', { name: '営業部の経費の承認者から鈴木を外す' })).toBeVisible(); // the chip
    expect(await db.org_unit_designations.count({ where: { unit_id: org.sales, kind: 'expense', user_id: USERS.suzuki.id } })).toBe(1);
    await unit.getByRole('button', { name: '営業部の経費の承認者から鈴木を外す' }).click();
    await expect(unit.getByTestId('designation-expense').getByText('指定なし')).toBeVisible();
    expect(await db.org_unit_designations.count({ where: { unit_id: org.sales } })).toBe(0);
  });
  test('部署を指定する権限のない人には、タブが出ない', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.sato });
    const page = await ctx.newPage();
    await page.goto('/org');
    await expect(page.getByRole('button', { name: '組織図' })).toBeVisible().catch(() => {});
    await expect(page.getByRole('button', { name: '承認者・評価者' })).toHaveCount(0);
    await ctx.close();
  });
});
