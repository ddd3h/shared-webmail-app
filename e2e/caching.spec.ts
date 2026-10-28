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

  test('ログアウトすると、その人の画像のキャッシュは捨てられる', async ({ playwright }) => {
    const acct = await newAccount('cache');
    await db.users.update({ where: { id: acct.id }, data: { mattermost_user_id: 'mm-cache-5' } });
    const ctx = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': '10.55.1.1' } });
    expect((await ctx.post('/api/auth/login', { data: { email: acct.email, password: PASSWORD } })).status()).toBe(200);
    await ctx.get('/api/user/avatar');
    await ctx.get('/api/user/avatar');
    expect(await mm.imageHits()).toBe(1);
    await ctx.post('/api/auth/logout');
    expect((await ctx.post('/api/auth/login', { data: { email: acct.email, password: PASSWORD } })).status()).toBe(200);
    await ctx.get('/api/user/avatar');
    expect(await mm.imageHits()).toBe(2);
    await ctx.dispose();
  });
});

// The sender icon lookup goes out to the internet, so the test only checks what does not need it
test.describe('送信者アイコン', () => {
  test('不正なメールアドレスは400、ログインしていないと使えない', async ({ as, anon }) => {
    const sato = await as('sato');
    expect((await sato.get('/api/sender-icon?email=not-an-address')).status()).toBe(400);
    expect((await sato.get(`/api/sender-icon?email=${'a'.repeat(330)}@example.com`)).status()).toBe(400);
    expect((await anon.get('/api/sender-icon?email=a@example.com', { maxRedirects: 0 })).status()).not.toBe(200);
  });
});
