import { test, expect } from './fixtures';
import { USERS } from './helpers/constants';
import { db } from './helpers/db';
import { postClaim, makeTrip } from './helpers/factories';
import { buildOrg } from './helpers/org';
import { resetOrg } from './helpers/seed';

// 役員の申請は、部署の長ではなく、ほかの役員（と管理者）が承認する。
// 営業部: 佐藤(課長) ・ 田中(メンバー) ・ 鈴木(メンバー)。田中と鈴木を役員にする。
test.describe.configure({ mode: 'serial' });
const reset = async () => { await resetOrg(); await db.users.updateMany({ where: { id: { in: [USERS.tanaka.id, USERS.suzuki.id, USERS.sato.id, USERS.yamada.id] } }, data: { worker_type: 'employee' } }); await db.users.update({ where: { id: USERS.yamada.id }, data: { worker_type: 'executive' } }); };
test.beforeEach(reset);
test.afterAll(reset);

const review = (c: Promise<import('@playwright/test').APIRequestContext>, kind: 'expenses' | 'trips', id: string) => c.then(x => x.post(`/api/${kind}/${id}/review`, { data: { action: 'approve', comment: 'ok' } }));
const makeExecutives = () => db.users.updateMany({ where: { id: { in: [USERS.tanaka.id, USERS.suzuki.id] } }, data: { worker_type: 'executive' } });

test.describe('役員の申請', () => {
  test('経費: 部署の課長は承認できない。ほかの役員と管理者は承認できる。自分では承認できない', async ({ as }) => {
    const org = await buildOrg(as);
    await makeExecutives();
    const mk = async () => (await (await postClaim(await as('tanaka'), { unit_id: org.sales })).json()).id as string;
    expect((await review(as('sato'), 'expenses', await mk())).status()).toBe(403);   // 営業部の課長でも、役員の申請は決められない
    expect((await review(as('tanaka'), 'expenses', await mk())).status()).toBe(403); // 自分の申請
    expect((await review(as('suzuki'), 'expenses', await mk())).status()).toBe(200); // ほかの役員（部署の権限はなくてよい）
    expect((await review(as('admin'), 'expenses', await mk())).status()).toBe(200);
  });

  test('出張も同じ', async ({ as }) => {
    await buildOrg(as);
    await makeExecutives();
    const t1 = await makeTrip({ role: 'tanaka', status: 'pending' });
    const t2 = await makeTrip({ role: 'tanaka', status: 'pending' });
    expect((await review(as('sato'), 'trips', t1.id)).status()).toBe(403);
    expect((await review(as('suzuki'), 'trips', t2.id)).status()).toBe(200);
  });

  test('役員でない人の申請は、これまで通り部署の課長が承認する（役員は部署の権限がなければ承認できない）', async ({ as }) => {
    const org = await buildOrg(as);
    await db.users.update({ where: { id: USERS.suzuki.id }, data: { worker_type: 'executive' } });
    const id = (await (await postClaim(await as('tanaka'), { unit_id: org.sales })).json()).id as string;
    expect((await review(as('suzuki'), 'expenses', id)).status()).toBe(403);
    expect((await review(as('sato'), 'expenses', id)).status()).toBe(200);
  });

  test('承認待ちの一覧: 役員の申請は、ほかの役員にだけ出る（課長には出ない）。メニューにも承認が出る', async ({ as }) => {
    const org = await buildOrg(as);
    await makeExecutives();
    await postClaim(await as('tanaka'), { unit_id: org.sales, title: '役員の経費' });
    const titles = async (who: Parameters<typeof as>[0]) => ((await (await (await as(who)).get('/api/approvals')).json()).expenses ?? []).map((e: { title: string }) => e.title);
    expect(await titles('sato')).not.toContain('役員の経費');
    expect(await titles('suzuki')).toContain('役員の経費');
    expect(await titles('admin')).toContain('役員の経費');
    expect(await titles('tanaka')).not.toContain('役員の経費');
    expect((await (await (await as('suzuki')).get('/api/work/me')).json()).can_approve).toBe(true);
  });
});
