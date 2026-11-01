import { test, expect } from './fixtures';
import { MAILBOX_ID, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { SUPPORT, cleanup, seed } from './helpers/team-mailboxes';
import { makePayment, makeVendor } from './helpers/factories';
import { buildOrg } from './helpers/org';
import { resetOrg, resetTransfers } from './helpers/seed';

// ゼロトラストの見方: どの通信も、誰が・何に対して・してよいかを、その都度（URLや画面を信用せず）サーバーで確かめる。
// ここは、確認で見つけた「対象のモノ（スレッド・下書き・給与…）に対する権限の確認が足りなかった」ところが、ふさがっていることのテスト。
test.describe.configure({ mode: 'serial' });
const wipe = async () => { await db.drafts.deleteMany({}); await db.thread_assignments.deleteMany({}); await db.mattermost_links.deleteMany({}); await db.mattermost_forwards.deleteMany({}); };
test.beforeEach(async () => { await wipe(); await seed(); });
test.afterAll(async () => { await wipe(); await cleanup(); await resetTransfers(); });

type As = (r: any) => Promise<import('@playwright/test').APIRequestContext>;
const threadOf = async (mailboxId: string) => (await db.threads.findFirstOrThrow({ where: { mailbox_id: mailboxId } })).id;
const PERSONAL = 'mb_personal_sato';
async function personalThread() {
  await db.mailboxes.upsert({ where: { id: PERSONAL }, create: { id: PERSONAL, type: 'personal', display_name: '佐藤の個人', email_address: 'sato.personal@e2e.test', owner_user_id: USERS.sato.id, is_active: true }, update: {} });
  const at = new Date();
  return (await db.threads.create({ data: { mailbox_id: PERSONAL, subject: '佐藤だけの内容', normalized_subject: '佐藤だけの内容', last_message_at: at, last_received_at: at, unread_count: 1 } })).id;
}
test.afterEach(async () => { await db.threads.deleteMany({ where: { mailbox_id: PERSONAL } }); await db.mailboxes.deleteMany({ where: { id: PERSONAL } }); });

test.describe('スレッド: 見られないメールボックスのスレッドには、手を出せない', () => {
  test('一括操作（ids）は、見られるスレッドだけに効く。他人の個人メールボックスのスレッドは削除も既読も迷惑メール指定もできない', async ({ as }) => {
    const id = await personalThread();
    const admin = await as('admin'); // an admin has no way into a personal mailbox
    for (const body of [{ action: 'delete', ids: [id] }, { action: 'read', ids: [id] }, { action: 'spam', ids: [id] }, { action: 'status', status: 'done', ids: [id] }]) {
      const res = await admin.post('/api/threads/bulk', { data: body });
      expect((await res.json()).count ?? 0).toBe(0);
    }
    const t = await db.threads.findUniqueOrThrow({ where: { id } });
    expect(t).toMatchObject({ status: 'open', is_spam: false });
    expect(await db.thread_reads.count({ where: { thread_id: id } })).toBe(0);
    // the owner can
    expect((await (await (await as('sato')).post('/api/threads/bulk', { data: { action: 'status', status: 'done', ids: [id] } })).json()).count).toBe(1);
  });

  test('一括の削除で、threadsを1件ずつ名指しすれば大量削除の承認の確認を避けられる、ということはない（filters を付けなくても確認される）', async ({ as }) => {
    // 3 threads of the team mailbox; deleting them all is 100% of it: approval is required whatever filter the client sends
    const sato = await as('sato');
    const ids = (await db.threads.findMany({ where: { mailbox_id: MAILBOX_ID }, select: { id: true } })).map(t => t.id);
    const res = await sato.post('/api/threads/bulk', { data: { action: 'delete', ids } });
    const body = await res.json();
    expect(body.error).toBe('approval_required');
    expect(await db.threads.count({ where: { id: { in: ids } } })).toBe(ids.length);
  });

  test('Mattermostへの共有・連携は、そのスレッドを見られる人だけ（見られない人には、存在しないのと同じ）', async ({ as }) => {
    const tid = await threadOf(SUPPORT); // sato only
    const tanaka = await as('tanaka');
    expect((await tanaka.post(`/api/threads/${tid}/mattermost/discuss`)).status()).toBe(404);
    expect((await tanaka.post(`/api/threads/${tid}/mattermost/forward`, { data: { channel_id: 'x' } })).status()).toBe(404);
    expect((await tanaka.post(`/api/threads/${tid}/mattermost/link`, { data: { channel_id: 'c', permalink: 'https://evil.example/login' } })).status()).toBe(404);
    expect(await db.mattermost_links.count({ where: { thread_id: tid } })).toBe(0);
    expect(await db.mattermost_forwards.count({ where: { thread_id: tid } })).toBe(0);
  });

  test('連携のリンクは、会社のMattermostのURLだけ（見られる人でも、外のサイトのURLは登録できない）', async ({ as }) => {
    const tid = await threadOf(MAILBOX_ID);
    const sato = await as('sato');
    for (const permalink of ['https://evil.example/phish', 'javascript:alert(1)', 'not a url', '//evil.example']) {
      expect((await sato.post(`/api/threads/${tid}/mattermost/link`, { data: { channel_id: 'c', permalink } })).status(), permalink).toBe(400);
    }
    expect(await db.mattermost_links.count({ where: { thread_id: tid } })).toBe(0);
  });

  test('個人メールボックスのスレッドの移動は、持ち主だけ（管理者でも不可）。行き先は、自分が入っているチームのメールボックスだけ', async ({ as }) => {
    const id = await personalThread();
    expect((await (await as('admin')).post(`/api/threads/${id}/move`, { data: { target_mailbox_id: MAILBOX_ID } })).status()).toBe(403);
    expect((await (await as('sato')).post(`/api/threads/${id}/move`, { data: { target_mailbox_id: 'mb_nowhere' } })).status()).toBe(404);
    // suzuki is in no team: nothing of theirs can be pushed into the sales mailbox
    await db.mailboxes.update({ where: { id: PERSONAL }, data: { owner_user_id: USERS.suzuki.id } });
    expect((await (await as('suzuki')).post(`/api/threads/${id}/move`, { data: { target_mailbox_id: MAILBOX_ID } })).status()).toBe(403);
    await db.mailboxes.update({ where: { id: PERSONAL }, data: { owner_user_id: USERS.sato.id } });
    expect((await (await as('sato')).post(`/api/threads/${id}/move`, { data: { target_mailbox_id: MAILBOX_ID } })).status()).toBe(200);
  });

  test('担当の割り当ては、そのメールボックスを見られる人にだけ（見られない人を担当にして、件名やリンクを送ることはできない）', async ({ as }) => {
    const tid = await threadOf(MAILBOX_ID);
    const admin = await as('admin'); // can_assign on the sales mailbox
    expect((await admin.post(`/api/threads/${tid}/assign`, { data: { user_id: USERS.suzuki.id } })).status()).toBe(400);
    expect((await admin.post(`/api/threads/${tid}/assign`, { data: { user_id: 'u_nobody' } })).status()).toBe(400);
    expect((await admin.post(`/api/threads/${tid}/assign`, { data: { user_id: USERS.sato.id } })).status()).toBe(200);
    expect((await db.threads.findUniqueOrThrow({ where: { id: tid } })).assigned_user_id).toBe(USERS.sato.id);
  });
});

test.describe('下書き: 見られない・返信できないメールボックスやスレッドには、作れない', () => {
  test('他人のスレッド・メールボックスを指定した下書きは作れない。共有の下書きを、見られないチームに置くこともできない', async ({ as }) => {
    const supportThread = await threadOf(SUPPORT); // sato only
    const tanaka = await as('tanaka');
    expect((await tanaka.post('/api/drafts', { data: { thread_id: supportThread, subject: 'x' } })).status()).toBe(403);
    expect((await tanaka.post('/api/drafts', { data: { mailbox_id: SUPPORT, is_shared: true, subject: 'x' } })).status()).toBe(403);
    expect((await tanaka.post('/api/drafts', { data: { mailbox_id: MAILBOX_ID, thread_id: supportThread, subject: 'x' } })).status()).toBe(403);
    expect(await db.drafts.count({ where: { user_id: USERS.tanaka.id } })).toBe(0);
  });

  test('自分が返信できるメールボックスの下書きは、これまでどおり作れる。あとから別のチームへ付け替えることはできない', async ({ as }) => {
    const sato = await as('sato');
    const res = await sato.post('/api/drafts', { data: { mailbox_id: MAILBOX_ID, thread_id: await threadOf(MAILBOX_ID), subject: '返信' } });
    expect(res.status()).toBe(200);
    const id = (await res.json()).id;
    expect((await sato.put(`/api/drafts/${id}`, { data: { mailbox_id: 'mb_nowhere' } })).status()).toBe(403);
    expect((await sato.put(`/api/drafts/${id}`, { data: { subject: '直した' } })).status()).toBe(200);
    const tanaka = await as('tanaka'); // can view only: no reply, so no draft of the team's
    expect((await tanaka.post('/api/drafts', { data: { mailbox_id: MAILBOX_ID, subject: 'x' } })).status()).toBe(403);
  });
});

test.describe('定期処理の呼び出し（/api/cron）', () => {
  test('秘密を持たない呼び出しは通らない。「Bearer undefined」も', async ({ anon }) => {
    for (const path of ['/api/cron/sync', '/api/cron/scheduled-send', '/api/cron/embeddings']) {
      for (const auth of [undefined, 'Bearer undefined', 'Bearer ', 'Bearer wrong']) {
        const res = await anon.get(path, { headers: auth ? { authorization: auth } : {}, maxRedirects: 0 });
        expect(res.status(), `${path} ${auth}`).toBe(401);
      }
    }
  });
});

test.describe('管理画面の設定の書き込み', () => {
  test('管理していない項目や、改行を含む値は書き込めない（サーバーの環境ファイルに、好きな値を入れられない）', async ({ as }) => {
    const admin = await as('admin');
    for (const updates of [
      [{ key: 'NODE_OPTIONS', value: '--require /tmp/x.js' }],
      [{ key: 'lowercase', value: 'x' }],
      [{ key: 'SYNC_DEFAULT_INTERVAL_SEC', value: '30\nSESSION_SECRET=attacker' }],
      [{ key: 'SYNC_DEFAULT_INTERVAL_SEC', value: 'x'.repeat(10_001) }],
    ]) {
      const res = await admin.put('/api/admin/settings', { data: { updates } });
      expect(res.status(), JSON.stringify(updates).slice(0, 60)).toBe(400);
      expect((await res.json()).error).toBe('invalid_setting');
    }
    expect(await db.app_settings.count({ where: { key: 'NODE_OPTIONS' } })).toBe(0);
    expect((await admin.put('/api/admin/settings', { data: { updates: [{ key: 'SYNC_DEFAULT_INTERVAL_SEC', value: '45', isSecret: false }] } })).status()).toBe(200);
  });
});

test.describe('お金: 自分についての金額は、自分で登録・確認しない', () => {
  test('経理担当・管理者は、自分の給与明細を作れない・直せない・消せない（ほかに経理担当・管理者がいる間）。他の人の分は作れる', async ({ as }) => {
    const keiri = await as('keiri');
    const body = (userId: string) => ({ userId, pay_month: '2026-10', title: '給与', status: 'planned', items: [{ kind: 'earning', label: '基本給', amount: 300000 }] });
    const own = await keiri.post('/api/work/payslips', { data: body(USERS.keiri.id) });
    expect(own.status()).toBe(403);
    expect((await own.json()).error).toBe('self_dealing');
    const theirs = await keiri.post('/api/work/payslips', { data: body(USERS.sato.id) });
    expect(theirs.status()).toBe(201);
    // a statement about keiri, made by an admin, cannot be changed or removed by keiri
    const made = await (await (await as('admin')).post('/api/work/payslips', { data: body(USERS.keiri.id) })).json();
    expect((await keiri.put(`/api/work/payslips/${made.id}`, { data: { ...body(USERS.keiri.id), items: [{ kind: 'earning', label: '基本給', amount: 9_999_999 }] } })).status()).toBe(403);
    expect((await keiri.delete(`/api/work/payslips/${made.id}`)).status()).toBe(403);
    expect(await db.payslip_items.count({ where: { payslip_id: made.id, amount: 9_999_999 } })).toBe(0);
  });
});

test.describe('組織: 承認者の指定', () => {
  test('人事（管理者でない人）は、自分を経費の承認者に指定できない。評価者には指定できる', async ({ as }) => {
    const org = await buildOrg(as);
    const keiri = await as('keiri'); // HR (人事)
    const res = await keiri.put(`/api/org/units/${org.sales}/designations`, { data: { kind: 'expense', user_ids: [USERS.keiri.id] } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe('self_designation');
    expect((await keiri.put(`/api/org/units/${org.sales}/designations`, { data: { kind: 'expense', user_ids: [USERS.suzuki.id] } })).status()).toBe(200);
    expect((await keiri.put(`/api/org/units/${org.sales}/designations`, { data: { kind: 'evaluation', user_ids: [USERS.keiri.id] } })).status()).toBe(200);
    expect((await (await as('admin')).put(`/api/org/units/${org.sales}/designations`, { data: { kind: 'expense', user_ids: [USERS.admin.id] } })).status()).toBe(200); // an admin may
    await resetOrg();
  });
});

test.describe('連絡先のGoogle連携の戻り', () => {
  test('始めたのと同じ人の、始めたときの値でなければ、連携は作られない（人のIDでは証明にならない）', async ({ as }) => {
    const c = await as('sato');
    const before = await db.google_oauth_tokens.count();
    const forged = await c.get(`/api/contacts/google/callback?code=abc&state=${USERS.sato.id}`, { maxRedirects: 0 });
    expect(forged.headers()['location']).toContain('google_error=invalid_state');
    const noState = await c.get('/api/contacts/google/callback?code=abc', { maxRedirects: 0 });
    expect(noState.headers()['location']).toContain('google_error=invalid_state');
    expect(await db.google_oauth_tokens.count()).toBe(before);
    const start = await c.get('/api/contacts/google/auth', { maxRedirects: 0 });
    const state = new URL(start.headers()['location']).searchParams.get('state')!;
    expect(state).not.toBe(USERS.sato.id);
    expect(start.headers()['set-cookie']).toContain(`gcontacts_oauth_state=${state}`);
  });
});

void makePayment; void makeVendor; void ({} as As);
