import { test, expect } from './fixtures';
import { AUTH, USERS, type Role } from './helpers/constants';
import { db } from './helpers/db';
import { CRITERIA, buildOrg, criteriaOf, formOf, openCycle, scoresFor } from './helpers/org';
import { mm } from './helpers/mattermost-mock';
import { clearNotifications, resetOrg } from './helpers/seed';
import { hasHorizontalOverflow } from './helpers/ui';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await resetOrg(); }); // leave no organisation behind for the other specs
test.beforeEach(async () => { await resetOrg(); await clearNotifications(); await mm.reset(); });

const put = (c: any, id: string, side: 'self' | 'manager', body: object) => c.put(`/api/evaluations/${id}/${side}`, { data: body });
const detail = async (c: any, id: string) => (await c.get(`/api/evaluations/${id}`)).json();

/** tanaka (営業部) is evaluated by sato; the 人事 person is keiri. Returns everything a test needs. */
async function setup(as: any) {
  await buildOrg(as);
  const keiri = await as('keiri');
  const cycle = await openCycle(keiri);
  const criteria = await criteriaOf(keiri, cycle);
  const form = await formOf(keiri, cycle, 'tanaka');
  return { keiri, cycle, criteria, form };
}
async function submitSelf(as: any, form: string, criteria: { id: string }[], score = 4) {
  expect((await put(await as('tanaka'), form, 'self', { scores: scoresFor(criteria, score), comment: '頑張りました', submit: true })).status()).toBe(200);
}
async function submitManager(as: any, form: string, criteria: { id: string }[], score = 5) {
  expect((await put(await as('sato'), form, 'manager', { scores: scoresFor(criteria, score), comment: '期待以上', submit: true })).status()).toBe(200);
}

test.describe('評価期間（人事）', () => {
  const body = (o: object = {}) => ({ name: '2026年度 上期', period_start: '2026-04-01', period_end: '2026-09-30', criteria: CRITERIA, ...o });

  test('評価期間を作れるのは管理者と「人事」の役職の人だけ', async ({ as }) => {
    await buildOrg(as);
    for (const r of ['sato', 'tanaka', 'yamada'] as const) expect((await (await as(r)).post('/api/evaluations/cycles', { data: body() })).status(), r).toBe(403);
    expect((await (await as('keiri')).post('/api/evaluations/cycles', { data: body() })).status()).toBe(201);
    expect((await (await as('admin')).post('/api/evaluations/cycles', { data: body() })).status()).toBe(201);
  });

  const bad: [string, object][] = [
    ['名前が空', { name: ' ' }], ['項目がない', { criteria: [] }], ['期間の順序が逆', { period_start: '2026-10-01', period_end: '2026-04-01' }], ['日付が不正', { period_start: '2026-02-30' }],
    ['重みが0', { criteria: [{ name: 'a', weight: 0 }] }], ['重みが11', { criteria: [{ name: 'a', weight: 11 }] }], ['項目名が空', { criteria: [{ name: '', weight: 1 }] }], ['項目が21個', { criteria: Array.from({ length: 21 }, (_, i) => ({ name: `k${i}`, weight: 1 })) }],
  ];
  for (const [label, over] of bad) {
    test(`不正な評価期間は作れない: ${label}`, async ({ as }) => {
      await buildOrg(as);
      expect((await (await as('keiri')).post('/api/evaluations/cycles', { data: body(over) })).status()).toBe(400);
      expect(await db.eval_cycles.count()).toBe(0);
    });
  }

  test('開始前は編集・削除できるが、開始後はできない', async ({ as }) => {
    await buildOrg(as);
    const keiri = await as('keiri');
    const id = (await (await keiri.post('/api/evaluations/cycles', { data: body() })).json()).id;
    expect((await keiri.put(`/api/evaluations/cycles/${id}`, { data: body({ name: '名前変更', criteria: [{ name: '新項目', weight: 2 }] }) })).status()).toBe(200);
    expect((await db.eval_criteria.findMany({ where: { cycle_id: id } })).map(c => c.name)).toEqual(['新項目']);
    expect((await keiri.post(`/api/evaluations/cycles/${id}/open`)).status()).toBe(200);
    expect((await keiri.put(`/api/evaluations/cycles/${id}`, { data: body() })).status()).toBe(409);
    expect((await keiri.delete(`/api/evaluations/cycles/${id}`)).status()).toBe(409);
    expect((await keiri.post(`/api/evaluations/cycles/${id}/open`)).status()).toBe(409);
  });

  test('開始すると全員分の評価票ができ、評価者は、その部署で一つ上の役職の人（いなければ上の部署の一番上の人）になる', async ({ as }) => {
    await buildOrg(as);
    const keiri = await as('keiri');
    const id = (await (await keiri.post('/api/evaluations/cycles', { data: body() })).json()).id;
    const res = await (await keiri.post(`/api/evaluations/cycles/${id}/open`)).json();
    expect(res.created).toBe(Object.keys(USERS).length);
    const evaluatorOf = async (r: Role) => (await db.evaluations.findFirst({ where: { cycle_id: id, user_id: USERS[r].id } }))!.evaluator_id;
    expect(await evaluatorOf('tanaka')).toBe(USERS.sato.id); // 営業部の課長
    expect(await evaluatorOf('suzuki')).toBe(USERS.sato.id);
    expect(await evaluatorOf('sato')).toBe(USERS.admin.id); // 営業部で一番上 → 本社の部長
    expect(await evaluatorOf('yamada')).toBe(USERS.admin.id);
    expect(await evaluatorOf('keiri')).toBe(USERS.admin.id); // 本社の「人事」(序列15)の上は部長(30)
    expect(await evaluatorOf('guest')).toBeNull(); // どの部署にもいない
    expect(res.withoutEvaluator).toBeGreaterThanOrEqual(1);
  });

  test('評価の権限（役職）がない上の人は評価者にならず、さらに上の人になる', async ({ as }) => {
    const org = await buildOrg(as);
    await (await as('admin')).put(`/api/org/positions/${org.positions['課長']}`, { data: { name: '課長', level: 20, permissions: ['approve_requests'] } });
    const id = await openCycle(await as('keiri'));
    expect((await db.evaluations.findFirst({ where: { cycle_id: id, user_id: USERS.tanaka.id } }))!.evaluator_id).toBe(USERS.admin.id);
  });

  test('評価期間の一覧: 人事は全部、一般ユーザーは自分が関わる開始済みのものだけ', async ({ as }) => {
    await buildOrg(as);
    const keiri = await as('keiri');
    const draft = (await (await keiri.post('/api/evaluations/cycles', { data: body({ name: '準備中の期間' }) })).json()).id;
    await openCycle(keiri, '開始済みの期間');
    const names = async (r: Role) => ((await (await (await as(r)).get('/api/evaluations/cycles')).json()).items as any[]).map(c => c.name).sort();
    expect(await names('keiri')).toEqual(['準備中の期間', '開始済みの期間']);
    expect(await names('tanaka')).toEqual(['開始済みの期間']);
    expect((await (await as('tanaka')).get(`/api/evaluations/cycles/${draft}`)).status()).toBe(403);
  });
});

test.describe('評価の流れ', () => {
  test('自己評価 → 上長評価 → 確定 → 本人に公開、の順に進む', async ({ as }) => {
    const { keiri, criteria, form } = await setup(as);
    const tanaka = await as('tanaka'), sato = await as('sato');
    expect((await detail(tanaka, form)).stage).toBe('self');
    await submitSelf(as, form, criteria, 4);
    expect((await detail(tanaka, form)).stage).toBe('manager');
    await submitManager(as, form, criteria, 5);
    expect((await detail(sato, form)).stage).toBe('review');
    const fin = await keiri.post(`/api/evaluations/${form}/finalize`, { data: {} });
    expect(await fin.json()).toMatchObject({ ok: true, score: 5, grade: 'S' });
    const mine = await detail(tanaka, form);
    expect(mine).toMatchObject({ stage: 'done', grade: 'S', score: 5 });
    expect(mine.criteria.map((c: any) => c.manager_score)).toEqual([5, 5]);
  });

  test('総合点は重みつきの平均で、等級に変換される', async ({ as }) => {
    const { keiri, criteria, form } = await setup(as); // weights 3 and 1
    await submitSelf(as, form, criteria);
    const scores = [{ criterion_id: criteria[0].id, score: 4, comment: null }, { criterion_id: criteria[1].id, score: 2, comment: null }]; // (4*3 + 2*1) / 4 = 3.5
    expect((await put(await as('sato'), form, 'manager', { scores, submit: true })).status()).toBe(200);
    expect(await (await keiri.post(`/api/evaluations/${form}/finalize`, { data: {} })).json()).toMatchObject({ score: 3.5, grade: 'A' });
  });

  test('下書きは保存でき、提出するまで何度でも直せる。提出すると固定される', async ({ as }) => {
    const { criteria, form } = await setup(as);
    const tanaka = await as('tanaka');
    expect((await put(tanaka, form, 'self', { scores: [{ criterion_id: criteria[0].id, score: 3, comment: null }], submit: false })).status()).toBe(200);
    expect((await put(tanaka, form, 'self', { scores: [{ criterion_id: criteria[0].id, score: 5, comment: 'やり直し' }], submit: false })).status()).toBe(200);
    expect((await detail(tanaka, form)).criteria[0]).toMatchObject({ self_score: 5, self_comment: 'やり直し' });
    const half = await put(tanaka, form, 'self', { scores: [], submit: true });
    expect(half.status()).toBe(400);
    expect((await half.json()).error).toBe('incomplete');
    await submitSelf(as, form, criteria, 3);
    const again = await put(tanaka, form, 'self', { scores: scoresFor(criteria, 1), submit: false });
    expect(again.status()).toBe(409);
    expect((await again.json()).error).toBe('already_submitted');
  });

  const badScores: [string, number][] = [['0点', 0], ['6点', 6], ['小数', 2.5], ['負の数', -1]];
  for (const [label, score] of badScores) {
    test(`点数は1〜5の整数だけ: ${label}`, async ({ as }) => {
      const { criteria, form } = await setup(as);
      expect((await put(await as('tanaka'), form, 'self', { scores: [{ criterion_id: criteria[0].id, score, comment: null }], submit: false })).status()).toBe(400);
    });
  }

  test('別の評価期間の項目は指定できない', async ({ as }) => {
    const { keiri, form } = await setup(as);
    const other = await openCycle(keiri, '別の期間');
    const foreign = await criteriaOf(keiri, other);
    const res = await put(await as('tanaka'), form, 'self', { scores: scoresFor(foreign, 3), submit: false });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('unknown_criterion');
  });

  test('上長は、本人の自己評価が出るまで評価できない。自己評価も見えない', async ({ as }) => {
    const { criteria, form } = await setup(as);
    await put(await as('tanaka'), form, 'self', { scores: scoresFor(criteria, 2), comment: '下書き', submit: false });
    const sato = await as('sato');
    const res = await put(sato, form, 'manager', { scores: scoresFor(criteria, 5), submit: true });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe('self_not_submitted');
    const seen = await detail(sato, form);
    expect(seen.criteria.map((c: any) => c.self_score)).toEqual([null, null]);
    expect(seen.self_comment).toBeNull();
  });

  test('本人は、確定するまで上長の点数・コメントを見られない（人事・評価者は見られる）', async ({ as }) => {
    const { keiri, criteria, form } = await setup(as);
    await submitSelf(as, form, criteria);
    await submitManager(as, form, criteria, 2);
    const tanaka = await as('tanaka');
    const hidden = await detail(tanaka, form);
    expect(hidden.criteria.map((c: any) => c.manager_score)).toEqual([null, null]);
    expect(hidden).toMatchObject({ manager_comment: null, score: null, grade: null });
    expect(JSON.stringify(hidden)).not.toContain('期待以上');
    expect((await detail(await as('sato'), form)).criteria.map((c: any) => c.manager_score)).toEqual([2, 2]);
    expect((await detail(keiri, form)).criteria.map((c: any) => c.manager_score)).toEqual([2, 2]);
    // the list does not leak the grade either
    const row = (await (await tanaka.get('/api/evaluations?scope=mine')).json()).items[0];
    expect(row.grade).toBeNull();
  });

  test('本人は上長の欄を、上長は本人の欄を書けない。評価者以外は何も書けない', async ({ as }) => {
    const { criteria, form } = await setup(as);
    await submitSelf(as, form, criteria);
    const body = { scores: scoresFor(criteria, 5), submit: false };
    expect((await put(await as('tanaka'), form, 'manager', body)).status()).toBe(403);
    expect((await put(await as('sato'), form, 'self', body)).status()).toBe(403);
    for (const r of ['suzuki', 'yamada', 'keiri', 'admin'] as const) expect((await put(await as(r), form, 'manager', body)).status(), r).toBe(403);
  });

  test('関係のない人は評価票を見られない', async ({ as }) => {
    const { form } = await setup(as);
    for (const r of ['suzuki', 'yamada']) expect((await (await as(r as Role)).get(`/api/evaluations/${form}`)).status(), r).toBe(403);
    for (const r of ['suzuki', 'yamada']) expect((await (await as(r as Role)).get(`/api/evaluations?scope=all`)).status(), r).toBe(403);
    expect((await (await as('tanaka')).get('/api/evaluations?scope=all')).status()).toBe(403);
    expect((await (await as('tanaka')).get('/api/evaluations?scope=x')).status()).toBe(400);
  });

  test('一覧: 自分の評価・担当しているメンバーの評価・全員分（人事）が分かれている', async ({ as }) => {
    const { cycle } = await setup(as);
    const users = async (r: Role, scope: string) => ((await (await (await as(r)).get(`/api/evaluations?scope=${scope}`)).json()).items as any[]).map(i => i.user.name).sort();
    expect(await users('tanaka', 'mine')).toEqual(['田中']);
    expect(await users('sato', 'team')).toEqual(['田中', '鈴木']);
    expect(await users('tanaka', 'team')).toEqual([]);
    expect((await users('keiri', 'all')).length).toBe(Object.keys(USERS).length);
    expect(cycle).toBeTruthy();
  });

  test('下書きの期間の評価票は見えない', async ({ as }) => {
    await buildOrg(as);
    const keiri = await as('keiri');
    await keiri.post('/api/evaluations/cycles', { data: { name: '準備中', period_start: '2026-04-01', period_end: '2026-09-30', criteria: CRITERIA } });
    expect(((await (await keiri.get('/api/evaluations?scope=all')).json()).items as any[]).length).toBe(0);
  });
});

test.describe('確定', () => {
  test('上長の評価が出る前は確定できない', async ({ as }) => {
    const { keiri, criteria, form } = await setup(as);
    await submitSelf(as, form, criteria);
    const res = await keiri.post(`/api/evaluations/${form}/finalize`, { data: {} });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe('manager_not_submitted');
  });

  test('確定できるのは人事・管理者だけ。上長本人も確定できない', async ({ as }) => {
    const { criteria, form } = await setup(as);
    await submitSelf(as, form, criteria); await submitManager(as, form, criteria);
    for (const r of ['sato', 'tanaka', 'yamada'] as const) expect((await (await as(r)).post(`/api/evaluations/${form}/finalize`, { data: {} })).status(), r).toBe(403);
    expect((await (await as('admin')).post(`/api/evaluations/${form}/finalize`, { data: {} })).status()).toBe(200);
  });

  test('等級を変えるには理由が必要。理由があれば変更でき、本人にもその理由が見える', async ({ as }) => {
    const { keiri, criteria, form } = await setup(as);
    await submitSelf(as, form, criteria); await submitManager(as, form, criteria, 5);
    const no = await keiri.post(`/api/evaluations/${form}/finalize`, { data: { grade: 'A' } });
    expect(no.status()).toBe(400);
    expect((await no.json()).error).toBe('comment_required');
    expect((await keiri.post(`/api/evaluations/${form}/finalize`, { data: { grade: 'Z', final_comment: 'x' } })).status()).toBe(400);
    expect((await keiri.post(`/api/evaluations/${form}/finalize`, { data: { grade: 'A', final_comment: '全社の配分を調整しました' } })).status()).toBe(200);
    expect(await detail(await as('tanaka'), form)).toMatchObject({ grade: 'A', score: 5, final_comment: '全社の配分を調整しました' });
  });

  test('確定したら、書き直しも再確定も差し戻しも評価者の変更もできない', async ({ as }) => {
    const { keiri, criteria, form } = await setup(as);
    await submitSelf(as, form, criteria); await submitManager(as, form, criteria);
    await keiri.post(`/api/evaluations/${form}/finalize`, { data: {} });
    expect((await keiri.post(`/api/evaluations/${form}/finalize`, { data: {} })).status()).toBe(409);
    expect((await keiri.post(`/api/evaluations/${form}/reopen`, { data: { side: 'manager' } })).status()).toBe(409);
    expect((await keiri.put(`/api/evaluations/${form}/evaluator`, { data: { evaluator_id: USERS.admin.id } })).status()).toBe(409);
    expect((await put(await as('sato'), form, 'manager', { scores: scoresFor(criteria, 1), submit: false })).status()).toBe(409);
  });

  test('自分の評価は、他に確定できる人がいる限り自分では確定できない', async ({ as }) => {
    const { keiri, criteria } = await setup(as);
    const own = await formOf(keiri, (await db.eval_cycles.findFirst())!.id, 'keiri');
    await keiri.put(`/api/evaluations/${own}/evaluator`, { data: { evaluator_id: USERS.sato.id } });
    expect((await put(await as('admin'), own, 'manager', {})).status()).toBe(403); // 評価者ではない（本社の部長だが、この票の評価者は佐藤に変えた）
    expect((await put(keiri, own, 'self', { scores: scoresFor(criteria, 3), submit: true })).status()).toBe(200);
    expect((await put(await as('sato'), own, 'manager', { scores: scoresFor(criteria, 3), submit: true })).status()).toBe(200);
    const res = await keiri.post(`/api/evaluations/${own}/finalize`, { data: {} });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe('self_finalize');
    expect((await (await as('admin')).post(`/api/evaluations/${own}/finalize`, { data: {} })).status()).toBe(200);
  });

  test('差し戻すと本人（上長）が書き直せる。自己評価を戻すと上長の提出も戻る', async ({ as }) => {
    const { keiri, criteria, form } = await setup(as);
    await submitSelf(as, form, criteria); await submitManager(as, form, criteria);
    expect((await keiri.post(`/api/evaluations/${form}/reopen`, { data: { side: 'manager' } })).status()).toBe(200);
    expect((await detail(keiri, form)).stage).toBe('manager');
    await submitManager(as, form, criteria, 4);
    expect((await keiri.post(`/api/evaluations/${form}/reopen`, { data: { side: 'self' } })).status()).toBe(200);
    expect((await detail(keiri, form)).stage).toBe('self');
    expect((await put(await as('tanaka'), form, 'self', { scores: scoresFor(criteria, 2), submit: true })).status()).toBe(200);
    expect((await (await as('sato')).get(`/api/evaluations/${form}`)).status()).toBe(200);
    expect((await (await as('sato')).post(`/api/evaluations/${form}/reopen`, { data: { side: 'self' } })).status()).toBe(403);
  });

  test('評価者の変更: 人事だけ。評価できる人だけが選べ、本人は選べない', async ({ as }) => {
    const { keiri, form } = await setup(as);
    const set = (c: any, id: string | null) => c.put(`/api/evaluations/${form}/evaluator`, { data: { evaluator_id: id } });
    expect((await set(await as('sato'), USERS.admin.id)).status()).toBe(403);
    expect((await set(keiri, USERS.tanaka.id)).status()).toBe(400); // 本人
    expect((await set(keiri, USERS.suzuki.id)).status()).toBe(400); // 評価の権限がない
    expect((await set(keiri, USERS.yamada.id)).status()).toBe(200);
    expect((await db.evaluations.findUnique({ where: { id: form } }))!.evaluator_id).toBe(USERS.yamada.id);
    expect((await detail(await as('yamada'), form)).viewer.isEvaluator).toBe(true);
    expect((await (await as('sato')).get(`/api/evaluations/${form}`)).status()).toBe(403); // no longer the evaluator
  });

  test('期間の終了: 未確定があると止まり、force で終了できる。終了後は書けない', async ({ as }) => {
    const { keiri, cycle, criteria, form } = await setup(as);
    const stop = await keiri.post(`/api/evaluations/cycles/${cycle}/close`, { data: {} });
    expect(stop.status()).toBe(409);
    expect(await stop.json()).toMatchObject({ error: 'unfinalized', count: Object.keys(USERS).length });
    expect((await keiri.post(`/api/evaluations/cycles/${cycle}/close`, { data: { force: true } })).status()).toBe(200);
    expect((await put(await as('tanaka'), form, 'self', { scores: scoresFor(criteria, 3), submit: false })).status()).toBe(409);
    expect((await keiri.post(`/api/evaluations/cycles/${cycle}/close`, { data: {} })).status()).toBe(409);
  });

  test('操作が監査ログに残る', async ({ as }) => {
    const { keiri, criteria, form } = await setup(as);
    await submitSelf(as, form, criteria); await submitManager(as, form, criteria);
    await keiri.post(`/api/evaluations/${form}/finalize`, { data: {} });
    const kinds = (await db.audit_logs.findMany({ where: { action_type: { startsWith: 'eval_' } } })).map(a => a.action_type);
    expect(kinds).toEqual(expect.arrayContaining(['eval_cycle_create', 'eval_cycle_open', 'eval_self_submit', 'eval_manager_submit', 'eval_finalize']));
  });
});

test.describe('通知', () => {
  test('開始 → 全員、自己評価の提出 → 評価者、上長評価の提出 → 人事、確定 → 本人。点数・等級は載らない', async ({ as }) => {
    await buildOrg(as);
    const keiri = await as('keiri');
    const cycle = await openCycle(keiri);
    const opened = await mm.waitFor(p => p.message.includes('人事評価が始まりました'));
    expect(opened).toHaveLength(Object.keys(USERS).length);

    const criteria = await criteriaOf(keiri, cycle);
    const form = await formOf(keiri, cycle, 'tanaka');
    await mm.reset();
    await submitSelf(as, form, criteria, 4);
    expect((await mm.waitFor(p => p.message.includes('自己評価が提出されました'))).map(p => p.to)).toEqual(['mm-sato']);
    await mm.reset();
    await submitManager(as, form, criteria, 5);
    const hr = await mm.waitFor(p => p.message.includes('上長の評価が提出されました'));
    expect(hr.map(p => p.to).sort()).toEqual(['mm-admin', 'mm-admin2', 'mm-keiri']);
    await mm.reset();
    await keiri.post(`/api/evaluations/${form}/finalize`, { data: {} });
    const done = await mm.waitFor(p => p.message.includes('結果が公開されました'));
    expect(done.map(p => p.to)).toEqual(['mm-tanaka']);
    for (const p of [...hr, ...done]) { expect(p.message).not.toMatch(/[SABCD] ?[（(]|総合点|[0-9]\.[0-9]/); }
  });
});

test.describe('画面', () => {
  test.describe('メンバー（自己評価）', () => {
    test.use({ storageState: AUTH.tanaka });
    test('評価票に点数をつけて提出でき、提出後は固定される', async ({ page, as }) => {
      await setup(as);
      await page.goto('/evaluations');
      await page.getByRole('button', { name: /2026年度 上期/ }).click();
      await expect(page.getByText('自己評価待ち').first()).toBeVisible();
      for (const c of CRITERIA) await page.getByRole('button', { name: `${c.name} 4点`, exact: true }).click();
      await page.getByRole('textbox', { name: '業務の成果のコメント' }).fill('目標を達成しました');
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: '提出する' }).click();
      await expect(page.getByText('提出しました')).toBeVisible();
      await expect(page.getByRole('button', { name: '提出する' })).toHaveCount(0);
      const form = await db.evaluations.findFirst({ where: { user_id: USERS.tanaka.id }, include: { scores: true } });
      expect(form!.self_submitted_at).not.toBeNull();
      expect(form!.scores.map(s => s.self_score)).toEqual([4, 4]);
    });

    test('途中で下書き保存でき、開き直すと続きが入っている', async ({ page, as }) => {
      await setup(as);
      await page.goto('/evaluations');
      await page.getByRole('button', { name: /2026年度 上期/ }).click();
      await page.getByRole('button', { name: '業務の成果 3点', exact: true }).click();
      await page.getByRole('button', { name: '下書き保存' }).click();
      await expect(page.getByText('下書きを保存しました')).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: /2026年度 上期/ }).click();
      await expect(page.getByRole('button', { name: '業務の成果 3点', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });

    test('「メンバーの評価」「評価の運用」のタブは出ない', async ({ page, as }) => {
      await setup(as);
      await page.goto('/evaluations');
      await expect(page.getByRole('button', { name: 'メンバーの評価' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '評価の運用' })).toHaveCount(0);
    });

    test('確定後は結果（等級・上長の点数）が見える', async ({ page, as }) => {
      const { keiri, criteria, form } = await setup(as);
      await submitSelf(as, form, criteria); await submitManager(as, form, criteria, 5);
      await keiri.post(`/api/evaluations/${form}/finalize`, { data: {} });
      await page.goto('/evaluations');
      await expect(page.getByLabel('等級 S')).toBeVisible();
      await page.getByRole('button', { name: /2026年度 上期/ }).click();
      await expect(page.getByRole('status')).toContainText('S');
      await expect(page.getByRole('status')).toContainText('総合点 5 / 5');
    });
  });

  test.describe('上長', () => {
    test.use({ storageState: AUTH.sato });
    test('メンバーの自己評価を見ながら評価して提出できる（見込みの等級も出る）', async ({ page, as }) => {
      const { criteria, form } = await setup(as);
      await submitSelf(as, form, criteria, 3);
      await page.goto('/evaluations');
      await page.getByRole('button', { name: 'メンバーの評価' }).click();
      await page.getByRole('button', { name: /田中/ }).click();
      await expect(page.getByText('本人の自己評価: 3 点').first()).toBeVisible();
      for (const c of CRITERIA) await page.getByRole('button', { name: `${c.name} 5点`, exact: true }).click();
      await expect(page.getByText('総合点（見込み）5 / 5 → S')).toBeVisible();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: '提出する' }).click();
      await expect(page.getByText('提出しました')).toBeVisible();
      expect((await db.evaluations.findUnique({ where: { id: form } }))!.manager_submitted_at).not.toBeNull();
    });
  });

  test.describe('人事', () => {
    test.use({ storageState: AUTH.keiri });
    test('評価期間を作って開始し、進み具合を見て、確定できる', async ({ page, as }) => {
      await buildOrg(as);
      await page.goto('/evaluations');
      await page.getByRole('button', { name: '評価の運用' }).click();
      await page.getByRole('button', { name: '＋ 評価期間を作成' }).click();
      await page.getByPlaceholder('2026年度 上期').fill('2026年度 下期');
      await page.locator('input[type=date]').nth(0).fill('2026-10-01');
      await page.locator('input[type=date]').nth(1).fill('2027-03-31');
      await page.getByRole('button', { name: '保存' }).click();
      await expect(page.getByText('保存しました')).toBeVisible();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: '開始する' }).click();
      await expect(page.getByText('評価期間を開始しました')).toBeVisible();
      await expect(page.getByRole('region', { name: '2026年度 下期の評価一覧' })).toContainText('田中');
      expect(await db.evaluations.count()).toBe(Object.keys(USERS).length);

      // a finished form can be fixed from the list
      const cycle = (await db.eval_cycles.findFirst())!.id;
      const kc = await criteriaOf(await as('keiri'), cycle);
      const form = await formOf(await as('keiri'), cycle, 'tanaka');
      await submitSelf(as, form, kc); await submitManager(as, form, kc, 4);
      await page.reload();
      await page.getByRole('button', { name: '評価の運用' }).click();
      await page.getByRole('button', { name: '進み具合を見る' }).click();
      await page.getByRole('button', { name: /田中/ }).click();
      await expect(page.getByRole('region', { name: '人事の操作' })).toBeVisible();
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: '結果を確定して公開' }).click();
      await expect(page.getByText('確定しました')).toBeVisible();
      expect(await db.evaluations.findUnique({ where: { id: form } })).toMatchObject({ grade: 'A', score: 4 });
    });

    test('等級を変えるのに理由を書かないと、エラーになる', async ({ page, as }) => {
      const { criteria, form } = await setup(as);
      await submitSelf(as, form, criteria); await submitManager(as, form, criteria, 5);
      await page.goto('/evaluations');
      await page.getByRole('button', { name: '評価の運用' }).click();
      await page.getByRole('button', { name: '進み具合を見る' }).click();
      await page.getByRole('button', { name: /田中/ }).click();
      await page.getByLabel('確定する等級').selectOption('B');
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: '結果を確定して公開' }).click();
      await expect(page.getByText('等級を変えるときは、理由をコメントに書いてください')).toBeVisible();
    });
  });
});
