import { createHash } from 'node:crypto';
import { test, expect } from './fixtures';
import { BASE_URL, PASSWORD, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { mm } from './helpers/mattermost-mock';
import { deleteAccountsWithPrefix, newAccount } from './helpers/accounts';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await mm.reset(); });
test.afterAll(async () => { await deleteAccountsWithPrefix('cache'); await mm.reset(); });

// The profile picture comes from Mattermost once; after that the cache answers (src/lib/avatar.ts)
test.describe('プロフィール画像のキャッシュ', () => {
  test('同じ人の画像は、2回目からMattermostに聞かずにキャッシュから返る', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-1' } });
    const first = await admin.get(`/api/users/${acct.id}/avatar`);
    expect(first.status()).toBe(200);
    expect(first.headers()['content-type']).toBe('image/png');
    const bytes = await first.body();
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    const second = await admin.get(`/api/users/${acct.id}/avatar`);
    expect((await second.body()).equals(bytes)).toBe(true);
    expect(await mm.imageHits()).toBe(1);
    // other people have their own entry
    await db.users.update({ where: { id: USERS.sato.id }, data: { mattermost_user_id: 'mm-sato-1' } });
    expect((await admin.get(`/api/users/${USERS.sato.id}/avatar`)).status()).toBe(200);
    expect(await mm.imageHits()).toBe(2);
    await db.users.update({ where: { id: USERS.sato.id }, data: { mattermost_user_id: null } });
  });

  test('Mattermost IDを変えると、キャッシュを捨てて新しい画像を取り直す', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-2' } });
    await admin.get(`/api/users/${acct.id}/avatar`);
    await admin.get(`/api/users/${acct.id}/avatar`);
    expect(await mm.imageHits()).toBe(1);
    expect((await admin.put(`/api/users/${acct.id}`, { data: { mattermost_user_id: 'mm-cache-3' } })).status()).toBe(200);
    expect((await admin.get(`/api/users/${acct.id}/avatar`)).status()).toBe(200);
    expect(await mm.imageHits()).toBe(2);
  });

  test('画像のない人は404。あとからIDを設定すると、すぐ画像が出る', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    expect((await admin.get(`/api/users/${acct.id}/avatar`)).status()).toBe(404);
    expect((await admin.get(`/api/users/${acct.id}/avatar`)).status()).toBe(404);
    expect(await mm.imageHits()).toBe(0);
    await admin.put(`/api/users/${acct.id}`, { data: { mattermost_user_id: 'mm-cache-4' } });
    expect((await admin.get(`/api/users/${acct.id}/avatar`)).status()).toBe(200);
  });

  test('ログアウトしても、その人の画像のキャッシュは捨てない（ログインし直してもMattermostに聞き直さない）', async ({ playwright }) => {
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-5' } });
    const ctx = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': '10.55.1.1' } });
    expect((await ctx.post('/api/auth/login', { data: { email: acct.email, password: PASSWORD } })).status()).toBe(200);
    await ctx.get('/api/user/avatar');
    expect(await mm.imageHits()).toBe(1);
    await ctx.post('/api/auth/logout');
    expect((await ctx.post('/api/auth/login', { data: { email: acct.email, password: PASSWORD } })).status()).toBe(200);
    expect((await ctx.get('/api/user/avatar')).status()).toBe(200);
    expect(await mm.imageHits()).toBe(1);
    await ctx.dispose();
  });
});

// The pictures are also kept in the database (src/lib/image-store.ts), so a restart or a deploy, which empties the memory,
// does not send everyone back to Mattermost. A row put in by hand for a person never asked for before stands for that.
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const DAY = 24 * 3600 * 1000;
const keptAvatar = (userId: string, owner: string, fetchedAt = new Date()) =>
  db.image_cache.create({ data: { key: `avatar:${userId}`, user_id: userId, owner, data: GIF, content_type: 'image/gif', etag: '"seeded"', fetched_at: fetchedAt } });

test.describe('プロフィール画像: 再起動しても残る（DB）', () => {
  test('初めて取った画像はDBにも入る（どのMattermostユーザーの画像かも）', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-10' } });
    expect((await admin.get(`/api/users/${acct.id}/avatar`)).status()).toBe(200);
    const row = await db.image_cache.findUnique({ where: { key: `avatar:${acct.id}` } });
    expect(row).toMatchObject({ user_id: acct.id, owner: 'mm-cache-10', content_type: 'image/png' });
    expect(row?.data?.subarray(1, 4).toString()).toBe('PNG');
  });

  test('メモリが空でも、DBに残った画像を返し、Mattermostには聞かない', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-11' } });
    await keptAvatar(acct.id, 'mm-cache-11', new Date(Date.now() - 3600 * 1000));
    const res = await admin.get(`/api/users/${acct.id}/avatar`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/gif');
    expect((await res.body()).equals(GIF)).toBe(true);
    expect(await mm.imageHits()).toBe(0);
  });

  test('取り直す時期でも、Mattermostが落ちていれば前の画像を出し続ける', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-12' } });
    await keptAvatar(acct.id, 'mm-cache-12', new Date(Date.now() - 2 * DAY));
    await mm.imageMode('down');
    const res = await admin.get(`/api/users/${acct.id}/avatar`);
    expect(res.status()).toBe(200);
    expect((await res.body()).equals(GIF)).toBe(true);
    expect(await mm.imageHits()).toBe(1);
  });

  test('取り直したらMattermostに画像がなかった（404）なら、古い画像は出さない', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-13' } });
    await keptAvatar(acct.id, 'mm-cache-13', new Date(Date.now() - 2 * DAY));
    await mm.imageMode('missing');
    expect((await admin.get(`/api/users/${acct.id}/avatar`)).status()).toBe(404);
    expect((await db.image_cache.findUnique({ where: { key: `avatar:${acct.id}` } }))?.data ?? null).toBeNull();
  });

  test('別のMattermostユーザーのために取った行は使わない（IDの付け替えがどこで起きても、前の人の画像は出ない）', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await keptAvatar(acct.id, 'mm-somebody-else');
    // changed directly in the database: no forgetAvatar() ran
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-14' } });
    const res = await admin.get(`/api/users/${acct.id}/avatar`);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(await mm.imageHits()).toBe(1);
    expect((await db.image_cache.findUnique({ where: { key: `avatar:${acct.id}` } }))?.owner).toBe('mm-cache-14');
  });

  test('Mattermost IDを変えると、DBの行も捨てる', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-15' } });
    await admin.get(`/api/users/${acct.id}/avatar`);
    expect(await db.image_cache.count({ where: { key: `avatar:${acct.id}` } })).toBe(1);
    expect((await admin.put(`/api/users/${acct.id}`, { data: { mattermost_user_id: null } })).status()).toBe(200);
    expect(await db.image_cache.count({ where: { key: `avatar:${acct.id}` } })).toBe(0);
    expect((await admin.get(`/api/users/${acct.id}/avatar`)).status()).toBe(404);
  });

  test('その人を消すと、DBの画像も消える', async ({ as }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-16' } });
    await admin.get(`/api/users/${acct.id}/avatar`);
    await db.users.delete({ where: { id: acct.id } });
    expect(await db.image_cache.count({ where: { key: `avatar:${acct.id}` } })).toBe(0);
  });

  test('2回目からは304（中身を送らない）。ログインしていなければ304も返さない', async ({ as, anon }) => {
    const admin = await as('admin');
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-17' } });
    const first = await admin.get(`/api/users/${acct.id}/avatar`);
    const etag = first.headers()['etag'];
    expect(etag).toBeTruthy();
    expect(first.headers()['x-content-type-options']).toBe('nosniff');
    // a picture opened on its own runs nothing (the page policy, which allows inline scripts, must not replace this one)
    expect(first.headers()['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    const again = await admin.get(`/api/users/${acct.id}/avatar`, { headers: { 'If-None-Match': etag } });
    expect(again.status()).toBe(304);
    expect((await again.body()).length).toBe(0);
    const stranger = await anon.get(`/api/users/${acct.id}/avatar`, { headers: { 'If-None-Match': etag }, maxRedirects: 0 });
    expect([200, 304]).not.toContain(stranger.status());
  });
});

// The sender icon lookup goes out to the internet, so the tests only check what does not need it: a row kept in the
// database (as after a restart) answers without asking anyone.
const senderKey = (kind: 'email' | 'domain', value: string) => `sender:${createHash('sha256').update(`${kind}:${value}`).digest('hex')}`;

test.describe('送信者アイコン', () => {
  test('不正なメールアドレスは400、ログインしていないと使えない', async ({ as, anon }) => {
    const sato = await as('sato');
    expect((await sato.get('/api/sender-icon?email=not-an-address')).status()).toBe(400);
    expect((await sato.get(`/api/sender-icon?email=${'a'.repeat(330)}@example.com`)).status()).toBe(400);
    expect((await anon.get('/api/sender-icon?email=a@example.com', { maxRedirects: 0 })).status()).not.toBe(200);
  });

  test('DBに残ったアイコンを返す（再起動のあと）。2回目は304。アドレスはDBに平文で残らない', async ({ as }) => {
    const sato = await as('sato');
    const domain = `kept-${Date.now().toString(36)}.example`;
    await db.image_cache.create({ data: { key: senderKey('domain', domain), data: GIF, content_type: 'image/gif', etag: '"kept-icon"', source: 'favicon' } });
    const res = await sato.get(`/api/sender-icon?email=${encodeURIComponent(`someone@${domain}`)}`);
    expect(res.status()).toBe(200);
    expect((await res.body()).equals(GIF)).toBe(true);
    expect(res.headers()['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    const again = await sato.get(`/api/sender-icon?email=${encodeURIComponent(`other@${domain}`)}`, { headers: { 'If-None-Match': res.headers()['etag'] } });
    expect(again.status()).toBe(304);
    expect(await db.image_cache.count({ where: { key: { contains: domain } } })).toBe(0);
    await db.image_cache.delete({ where: { key: senderKey('domain', domain) } });
  });

  test('「アイコンなし」と分かっているアドレスは、DBの記録で404', async ({ as }) => {
    const sato = await as('sato');
    const email = `nobody-${Date.now().toString(36)}@gmail.com`;
    await db.image_cache.create({ data: { key: senderKey('email', email), data: null } });
    expect((await sato.get(`/api/sender-icon?email=${encodeURIComponent(email)}`)).status()).toBe(404);
    await db.image_cache.delete({ where: { key: senderKey('email', email) } });
  });
});
