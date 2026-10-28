import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { buildOrg, type OrgIds } from './helpers/org';
import { makeClaim, makeTrip } from './helpers/factories';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications, resetOrg } from './helpers/seed';
import { openWorkMenu } from './helpers/ui';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await resetOrg(); }); // leave no organisation behind for the other specs
test.beforeEach(async () => { await resetOrg(); await clearNotifications(); await mm.reset(); });

test.describe('組織の登録（システム管理者だけ）', () => {
  test('一般ユーザー・経理担当は部署・役職・配置を変えられない', async ({ as }) => {
    for (const r of ['sato', 'keiri'] as const) {
      const c = await as(r);
      expect((await c.post('/api/org/units', { data: { name: 'x' } })).status(), r).toBe(403);
      expect((await c.post('/api/org/positions', { data: { name: 'x' } })).status(), r).toBe(403);
      expect((await c.post('/api/org/positions/defaults')).status(), r).toBe(403);
      expect((await c.put(`/api/org/members/${USERS.tanaka.id}`, { data: { org_unit_id: null, position_id: null } })).status(), r).toBe(403);
    }
  });

  test('未ログインはログイン画面へ戻される', async ({ anon }) => {
    expect([307, 401]).toContain((await anon.get('/api/org', { maxRedirects: 0 })).status());
  });

  test('部署を作り、親子にでき、名前・親・部署長を変えられる', async ({ as }) => {
    const admin = await as('admin');
    const root = (await (await admin.post('/api/org/units', { data: { name: '本社' } })).json()).id;
    const child = (await (await admin.post('/api/org/units', { data: { name: '営業部', parent_id: root, head_user_id: USERS.sato.id } })).json()).id;
    expect(await db.org_units.findUnique({ where: { id: child } })).toMatchObject({ name: '営業部', parent_id: root, head_user_id: USERS.sato.id });
    expect((await admin.put(`/api/org/units/${child}`, { data: { name: '第一営業部', parent_id: root, head_user_id: USERS.yamada.id } })).status()).toBe(200);
    expect(await db.org_units.findUnique({ where: { id: child } })).toMatchObject({ name: '第一営業部', head_user_id: USERS.yamada.id });
  });

  const badUnits: [string, Record<string, unknown>][] = [['名前が空', { name: ' ' }], ['名前が長すぎる', { name: 'あ'.repeat(61) }], ['親が存在しない', { name: 'x', parent_id: 'nope' }], ['部署長が存在しない', { name: 'x', head_user_id: 'nope' }]];
  for (const [label, body] of badUnits) {
    test(`不正な部署は作れない: ${label}`, async ({ as }) => {
      expect((await (await as('admin')).post('/api/org/units', { data: body })).status()).toBe(label.includes('存在しない') ? 400 : 400);
      expect(await db.org_units.count()).toBe(0);
    });
  }

  test('自分や配下の部署を親にすることはできない（輪になるため）', async ({ as }) => {
    const admin = await as('admin');
    const a = (await (await admin.post('/api/org/units', { data: { name: 'A' } })).json()).id;
    const b = (await (await admin.post('/api/org/units', { data: { name: 'B', parent_id: a } })).json()).id;
    const c = (await (await admin.post('/api/org/units', { data: { name: 'C', parent_id: b } })).json()).id;
    for (const parent of [a === b ? a : c, b, c]) {
      const res = await admin.put(`/api/org/units/${a}`, { data: { name: 'A', parent_id: parent } });
      expect(res.status(), parent).toBe(400);
      expect((await res.json()).error).toBe('parent_loop');
    }
    expect((await admin.put(`/api/org/units/${a}`, { data: { name: 'A', parent_id: a } })).status()).toBe(400);
  });

  test('配下に部署がある部署は削除できない。空なら削除でき、所属していた人は未所属になる', async ({ as }) => {
    const admin = await as('admin');
    const org = await buildOrg(as);
    const res = await admin.delete(`/api/org/units/${org.headquarters}`);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe('has_children');
    const del = await admin.delete(`/api/org/units/${org.sales}`);
    expect((await del.json()).unassigned).toBe(3);
    expect((await db.users.findUnique({ where: { id: USERS.tanaka.id } }))!.org_unit_id).toBeNull();
    expect((await admin.delete('/api/org/units/none')).status()).toBe(404);
  });

  test('標準の役職（部長・課長・チームリーダー・メンバー）を作れ、2回目は何も増えない', async ({ as }) => {
    const admin = await as('admin');
    expect((await (await admin.post('/api/org/positions/defaults')).json()).created).toBe(4);
    expect((await (await admin.post('/api/org/positions/defaults')).json()).created).toBe(0);
    const listed = (await (await admin.get('/api/org')).json()).positions;
    expect(listed.map((p: any) => p.name)).toEqual(['部長', '課長', 'チームリーダー', 'メンバー']);
    expect(listed.find((p: any) => p.name === '課長').permissions).toEqual(['approve_requests', 'evaluate']);
  });

  test('役職: 同じ名前は作れず、存在しない権限も指定できない', async ({ as }) => {
    const admin = await as('admin');
    expect((await admin.post('/api/org/positions', { data: { name: '課長', permissions: [] } })).status()).toBe(201);
    expect((await admin.post('/api/org/positions', { data: { name: '課長', permissions: [] } })).status()).toBe(409);
    expect((await admin.post('/api/org/positions', { data: { name: '特別', permissions: ['root'] } })).status()).toBe(400);
    expect((await admin.post('/api/org/positions', { data: { name: '', permissions: [] } })).status()).toBe(400);
  });

  test('役職の権限を変え、削除すると、持っていた人は役職なしになる', async ({ as }) => {
    const admin = await as('admin');
    const org = await buildOrg(as);
    expect((await admin.put(`/api/org/positions/${org.positions['課長']}`, { data: { name: '課長', level: 20, permissions: ['evaluate'] } })).status()).toBe(200);
    expect((await db.org_positions.findUnique({ where: { id: org.positions['課長'] } }))!.permissions).toEqual(['evaluate']);
    expect((await admin.put(`/api/org/positions/${org.positions['課長']}`, { data: { name: '部長', permissions: [] } })).status()).toBe(409);
    expect((await (await admin.delete(`/api/org/positions/${org.positions['課長']}`)).json()).unassigned).toBe(1);
    expect((await db.users.findUnique({ where: { id: USERS.sato.id } }))!.position_id).toBeNull();
  });

  test('配置: 存在しない部署・役職は指定できない', async ({ as }) => {
    const admin = await as('admin');
    const put = (data: object) => admin.put(`/api/org/members/${USERS.tanaka.id}`, { data });
    expect((await put({ org_unit_id: 'nope', position_id: null })).status()).toBe(400);
    expect((await put({ org_unit_id: null, position_id: 'nope' })).status()).toBe(400);
    expect((await put({})).status()).toBe(400);
    expect((await admin.put('/api/org/members/nobody', { data: { org_unit_id: null, position_id: null } })).status()).toBe(404);
  });

  test('組織の変更はすべて監査ログに残る', async ({ as }) => {
    await buildOrg(as);
    const kinds = (await db.audit_logs.findMany({ where: { action_type: { startsWith: 'org_' } } })).map(a => a.action_type);
    expect(kinds).toEqual(expect.arrayContaining(['org_unit_create', 'org_position_create', 'org_position_defaults', 'org_member_update']));
  });
});

test.describe('組織図の閲覧', () => {
  test('一般ユーザーも見られるが、メールアドレスは管理者にだけ含まれる', async ({ as }) => {
    await buildOrg(as);
    const asUser = JSON.stringify(await (await (await as('tanaka')).get('/api/org')).json());
    expect(asUser).toContain('営業部');
    expect(asUser).not.toContain('@e2e.test');
    expect(JSON.stringify(await (await (await as('admin')).get('/api/org')).json())).toContain('sato@e2e.test');
  });

  test('自分の権限と、担当している部署（配下を含む）が返る', async ({ as }) => {
    const org = await buildOrg(as);
    const me = (await (await (await as('sato')).get('/api/org')).json()).me;
    expect(me.capabilities).toEqual(['approve_requests', 'evaluate']);
    expect(me.headed_unit_ids).toEqual([org.sales]);
    expect((await (await (await as('tanaka')).get('/api/org')).json()).me).toMatchObject({ capabilities: [], headed_unit_ids: [] });
    expect((await (await (await as('admin')).get('/api/org')).json()).me.headed_unit_ids.sort()).toEqual([org.dev, org.headquarters, org.sales].sort());
  });
});

test.describe('組織から決まる承認の権限', () => {
  const claim = (role: 'tanaka' | 'sato' | 'yamada') => makeClaim({ role, status: 'pending', title: `${role}の経費` });
  const review = async (c: any, who: any, id: string, action = 'approve') => (await c).post(`/api/expenses/${id}/review`, { data: { action, comment: 'x' } });

  test('部署長（権限のある役職）は、自分の部署のメンバーの経費を承認できる', async ({ as }) => {
    await buildOrg(as);
    const c = await claim('tanaka');
    expect((await review(as('sato'), null, c.id)).status()).toBe(200);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))).toMatchObject({ status: 'approved', reviewed_by_id: USERS.sato.id });
  });

  test('他の部署の部署長は承認できない（権限があっても範囲が違う）', async ({ as }) => {
    await buildOrg(as);
    const c = await claim('tanaka');
    const res = await review(as('yamada'), null, c.id);
    expect(res.status()).toBe(403);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.status).toBe('pending');
  });

  test('自分の申請は承認できない。上の部署の部署長（管理者）が承認する', async ({ as }) => {
    await buildOrg(as);
    const c = await claim('sato');
    expect((await review(as('sato'), null, c.id)).status()).toBe(403);
    expect((await review(as('admin'), null, c.id)).status()).toBe(200);
  });

  test('部署長でない人は、権限のある役職でも承認できない', async ({ as }) => {
    const org = await buildOrg(as);
    await (await as('admin')).put(`/api/org/members/${USERS.tanaka.id}`, { data: { org_unit_id: org.sales, position_id: org.positions['課長'] } });
    const c = await claim('suzuki' as any);
    expect((await review(as('tanaka'), null, c.id)).status()).toBe(403);
  });

  test('部署長でも、役職に権限がなければ承認できない。役職の権限を外すとすぐ効く', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    const c = await claim('tanaka');
    await admin.put(`/api/org/positions/${org.positions['課長']}`, { data: { name: '課長', level: 20, permissions: ['evaluate'] } });
    expect((await review(as('sato'), null, c.id)).status()).toBe(403);
    await admin.put(`/api/org/positions/${org.positions['課長']}`, { data: { name: '課長', level: 20, permissions: ['approve_requests'] } });
    expect((await review(as('sato'), null, c.id)).status()).toBe(200);
  });

  test('異動すると担当範囲が変わる: 開発部へ移ったメンバーは営業部の課長では承認できない', async ({ as }) => {
    const org = await buildOrg(as);
    await (await as('admin')).put(`/api/org/members/${USERS.tanaka.id}`, { data: { org_unit_id: org.dev, position_id: org.positions['メンバー'] } });
    const c = await claim('tanaka');
    expect((await review(as('sato'), null, c.id)).status()).toBe(403);
    expect((await review(as('yamada'), null, c.id)).status()).toBe(200);
  });

  test('配下の部署のメンバーも承認の対象（本社の部署長は全部署）', async ({ as }) => {
    const org = await buildOrg(as);
    const admin = await as('admin');
    await admin.put(`/api/org/units/${org.headquarters}`, { data: { name: '本社', parent_id: null, head_user_id: USERS.yamada.id } });
    const c = await claim('tanaka');
    expect((await review(as('yamada'), null, c.id)).status()).toBe(200); // 部長 of 本社 → 営業部 is below it
  });

  test('出張も同じルールで承認できる／できない', async ({ as }) => {
    await buildOrg(as);
    const t = await makeTrip({ role: 'tanaka', status: 'pending' });
    expect((await (await as('yamada')).post(`/api/trips/${t.id}/review`, { data: { action: 'approve' } })).status()).toBe(403);
    expect((await (await as('sato')).post(`/api/trips/${t.id}/review`, { data: { action: 'approve' } })).status()).toBe(200);
  });

  test('承認の権限があっても、返金・振込など別の権限は増えない', async ({ as }) => {
    await buildOrg(as);
    const sato = await as('sato');
    expect((await sato.get('/api/expenses?scope=all')).status()).toBe(403);
    expect((await sato.post('/api/expenses/reimburse', { data: { ids: ['x'] } })).status()).toBe(403);
    expect((await sato.get('/api/transfers/batches')).status()).toBe(403);
    expect((await sato.get('/api/bank-accounts')).status()).toBe(403);
    expect((await sato.get('/api/work/users')).status()).toBe(403);
  });

  test('承認待ちの一覧は、担当範囲のメンバーの分だけ（管理者は全員分）', async ({ as }) => {
    await buildOrg(as);
    await claim('tanaka'); await claim('yamada'); await makeTrip({ role: 'suzuki', status: 'pending' }); await makeTrip({ role: 'yamada', status: 'pending' });
    const list = async (r: any) => (await (await (await as(r)).get('/api/approvals')).json());
    const sato = await list('sato');
    expect(sato.expenses.map((e: any) => e.user.name)).toEqual(['田中']);
    expect(sato.trips.map((t: any) => t.user.name)).toEqual(['鈴木']);
    expect((await list('yamada')).expenses.map((e: any) => e.user.name)).toEqual([]);
    expect((await list('admin')).expenses).toHaveLength(2);
    expect(await list('tanaka')).toMatchObject({ allowed: false, expenses: [], trips: [] });
  });

  test('申請すると、申請者の部署長と管理者に通知が届く（本人には届かない）', async ({ as }) => {
    await buildOrg(as);
    const res = await (await as('tanaka')).post('/api/expenses', { multipart: { expense_date: '2026-10-20', category: '交通費', title: '部署長への通知', amount: '1200', payment_method: 'personal' } });
    expect(res.status()).toBe(201);
    const posts = await mm.waitFor(p => p.message.includes('部署長への通知'));
    expect(posts.map(p => p.to).sort()).toEqual(['mm-admin', 'mm-admin2', 'mm-sato']);
    expect(posts[0].message).toContain('/approvals');
  });
});

test.describe('画面', () => {
  test.describe('一般ユーザー', () => {
    test.use({ storageState: AUTH.tanaka });
    test('組織図が見え、編集用のタブは出ない。承認のメニューも出ない', async ({ page, as }) => {
      await buildOrg(as);
      await page.goto('/org');
      await expect(page.getByRole('heading', { level: 1, name: '組織' })).toBeVisible();
      const sales = page.getByRole('region', { name: '営業部' });
      await expect(sales).toContainText('部署長: 佐藤');
      await expect(sales).toContainText('田中');
      await expect(page.getByRole('button', { name: '役職と権限' })).toHaveCount(0);
      await page.goto('/threads');
      await openWorkMenu(page);
      await expect(page.locator('header').getByRole('link', { name: /^チームの承認/ })).toHaveCount(0);
    });
  });

  test.describe('部署長', () => {
    test.use({ storageState: AUTH.sato });
    test('メニューに「チームの承認」が出て、メンバーの経費を承認できる', async ({ page, as }) => {
      await buildOrg(as);
      const c = await makeClaim({ role: 'tanaka', status: 'pending', title: '画面で承認する経費', amount: 3300 });
      await page.goto('/threads');
      await openWorkMenu(page);
      await page.locator('header').getByRole('link', { name: /^チームの承認/ }).click();
      await expect(page).toHaveURL(/\/approvals/);
      await expect(page.getByText('画面で承認する経費')).toBeVisible();
      await page.getByRole('button', { name: '承認', exact: true }).click();
      await expect(page.getByText('田中さんの経費を承認しました')).toBeVisible();
      expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.status).toBe('approved');
    });

    test('却下には理由が必要で、理由つきで却下できる', async ({ page, as }) => {
      await buildOrg(as);
      const c = await makeClaim({ role: 'tanaka', status: 'pending', title: '却下される経費' });
      await page.goto('/approvals');
      await page.getByRole('button', { name: '却下…' }).click();
      await expect(page.getByRole('button', { name: '却下する' })).toBeDisabled();
      await page.getByRole('textbox').fill('領収書がありません');
      await page.getByRole('button', { name: '却下する' }).click();
      await expect(page.getByText('を却下しました')).toBeVisible();
      expect(await db.expense_claims.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'rejected', review_comment: '領収書がありません' });
    });
  });

  test.describe('システム管理者', () => {
    test.use({ storageState: AUTH.admin });

    test('部署を追加し、役職を作り、メンバーを配置できる', async ({ page }) => {
      await page.goto('/org');
      await page.getByRole('button', { name: '部署', exact: true }).click();
      await page.getByRole('button', { name: '＋ 部署を追加' }).click();
      await page.getByPlaceholder('営業部').fill('企画部');
      await page.getByRole('button', { name: '保存' }).click();
      await expect(page.getByText('保存しました')).toBeVisible();
      const unit = await db.org_units.findFirst({ where: { name: '企画部' } });
      expect(unit).not.toBeNull();

      await page.getByRole('button', { name: '役職と権限' }).click();
      await page.getByRole('button', { name: '標準の役職を作成' }).click();
      await expect(page.getByText('4件の標準の役職を追加しました')).toBeVisible();
      await page.getByRole('button', { name: '＋ 役職を追加' }).click();
      await page.getByPlaceholder('課長').fill('主任');
      await page.getByRole('checkbox', { name: /部下の経費・出張を承認する/ }).check();
      await page.getByRole('button', { name: '保存' }).click();
      await expect(page.getByText('保存しました')).toBeVisible();
      expect((await db.org_positions.findUnique({ where: { name: '主任' } }))!.permissions).toEqual(['approve_requests']);

      await page.getByRole('button', { name: 'メンバー配置' }).click();
      const saved = () => page.waitForResponse(r => r.url().includes(`/api/org/members/${USERS.tanaka.id}`) && r.request().method() === 'PUT');
      await Promise.all([saved(), page.getByLabel('田中の部署').selectOption(unit!.id)]);
      await expect(page.getByLabel('田中の部署')).toHaveValue(unit!.id); // the screen has reloaded the saved placement
      await Promise.all([saved(), page.getByLabel('田中の役職').selectOption({ label: '主任' })]);
      await expect(page.getByText('田中 さんを更新しました')).toBeVisible();
      expect(await db.users.findUnique({ where: { id: USERS.tanaka.id } })).toMatchObject({ org_unit_id: unit!.id });
      expect((await db.users.findUnique({ where: { id: USERS.tanaka.id }, include: { position: true } }))!.position!.name).toBe('主任');
    });

    test('配下の部署は、親の候補に出ない（輪にならない）', async ({ page, as }) => {
      await buildOrg(as);
      await page.goto('/org');
      await page.getByRole('button', { name: '部署', exact: true }).click();
      await page.locator('li', { hasText: '本社' }).first().getByRole('button', { name: '編集' }).click();
      const options = await page.locator('select').first().locator('option').allTextContents();
      expect(options).not.toContain('営業部');
      expect(options).not.toContain('開発部');
      expect(options).not.toContain('本社');
    });
  });
});
