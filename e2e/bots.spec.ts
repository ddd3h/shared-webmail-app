import { test, expect } from './fixtures';
import { db } from './helpers/db';

test.describe.configure({ mode: 'serial' });

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const as = (ua: string) => ({ headers: { 'user-agent': ua } });

test.beforeEach(async () => { await db.security_events.deleteMany({ where: { type: 'bot_blocked' } }); });

test.describe('ロボットの接続を断る', () => {
  test('AIのクローラは、ログイン画面もAPIも403', async ({ anon }) => {
    for (const ua of ['Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.1; +https://openai.com/gptbot)', 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'PerplexityBot/1.0', 'CCBot/2.0']) {
      expect((await anon.get('/login', as(ua))).status(), ua).toBe(403);
      const api = await anon.get('/api/threads', as(ua));
      expect(api.status(), ua).toBe(403);
      expect(await api.json()).toEqual({ error: 'bots_not_allowed' });
    }
  });

  test('curl・Python・自動操作ブラウザ・User-Agent なしも断る', async ({ anon }) => {
    for (const ua of ['curl/8.5.0', 'python-requests/2.31.0', 'Go-http-client/1.1', 'Mozilla/5.0 PhantomJS/2.1.1', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0.0.0 Selenium', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '']) {
      expect((await anon.get('/login', as(ua))).status(), JSON.stringify(ua)).toBe(403);
    }
  });

  test('ログイン済みのCookieを持っていても、ロボットは断る', async ({ as: asRole }) => {
    const sato = await asRole('sato');
    expect((await sato.get('/api/threads?type=personal', as(CHROME))).status()).toBe(200);
    expect((await sato.get('/api/threads?type=personal', as('GPTBot/1.1'))).status()).toBe(403);
    expect((await sato.post('/api/auth/logout', as('curl/8.5.0'))).status()).toBe(403);
  });

  test('人のブラウザは今までどおり通る', async ({ anon }) => {
    expect((await anon.get('/login', as(CHROME))).status()).toBe(200);
    expect((await anon.get('/login', as('Mozilla/5.0 (Linux; Android 12; CUBOT_P50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'))).status()).toBe(200);
  });

  test('robots.txt はロボットにも見せて、全面禁止を伝える。ページには noindex 系のヘッダーが付く', async ({ anon }) => {
    const res = await anon.get('/robots.txt', as('GPTBot/1.1'));
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('User-agent: GPTBot\nDisallow: /');
    expect(text).toContain('User-agent: ClaudeBot\nDisallow: /');
    expect(text).toMatch(/User-agent: \*\nDisallow: \/\n?$/);
    const login = await anon.get('/login', as(CHROME));
    expect(login.headers()['x-robots-tag']).toContain('noindex');
    expect(login.headers()['x-robots-tag']).toContain('noai');
    expect(await login.text()).toContain('name="robots" content="noindex');
  });

  test('定期処理（/api/cron）は、鍵があればスクリプトでも呼べる', async ({ anon }) => {
    const res = await anon.get('/api/cron/embeddings', { headers: { 'user-agent': 'curl/8.5.0', authorization: 'Bearer e2e-cron-secret-0123456789' } });
    expect(res.status()).toBe(200);
    expect((await anon.get('/api/cron/embeddings', as('curl/8.5.0'))).status()).toBe(401);
  });

  test('断ったことは管理者の記録に残る（同じ相手・同じ種類は1分に1回）', async ({ anon }) => {
    // an address of its own: the server keeps one note a minute per address and kind, and the tests above used the default one
    const from = (ua: string) => ({ headers: { 'user-agent': ua, 'x-forwarded-for': '198.51.100.77' } });
    for (let i = 0; i < 3; i++) await anon.get('/login', from('GPTBot/1.1'));
    await anon.get('/login', from('curl/8.5.0'));
    const rows = await db.security_events.findMany({ where: { type: 'bot_blocked' } });
    expect(rows.map(r => JSON.parse(r.detail ?? '{}').kind).sort()).toEqual(['ai_crawler', 'script']);
    expect(rows.every(r => r.ip === '198.51.100.77')).toBe(true);
    expect(JSON.parse(rows.find(r => JSON.parse(r.detail ?? '{}').kind === 'ai_crawler')!.detail!)).toMatchObject({ path: '/login' });
  });
});

test.describe('管理者の設定', () => {
  async function setBlock(admin: import('@playwright/test').APIRequestContext, on: boolean) {
    const p = await (await admin.get('/api/admin/security/policy', as(CHROME))).json();
    const { your_ip, ...rest } = p; void your_ip;
    const res = await admin.put('/api/admin/security/policy', { ...as(CHROME), data: { ...rest, block_bots: on } });
    expect(res.ok()).toBeTruthy();
  }

  test('オフにするとロボットも通り、オンに戻すとまた断る', async ({ as: asRole, anon }) => {
    const admin = await asRole('admin');
    try {
      expect((await (await admin.get('/api/admin/security/policy', as(CHROME))).json()).block_bots).toBe(true);
      await setBlock(admin, false);
      await new Promise(r => setTimeout(r, 400)); // the server remembers the settings for a moment
      expect((await anon.get('/login', as('GPTBot/1.1'))).status()).toBe(200);
    } finally {
      await setBlock(admin, true);
    }
    await new Promise(r => setTimeout(r, 400));
    expect((await anon.get('/login', as('GPTBot/1.1'))).status()).toBe(403);
  });

  test('画面にスイッチがあり、保存できる', async ({ browser, as: asRole }) => {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/admin.json' });
    const admin = await asRole('admin');
    try {
      const page = await ctx.newPage();
      await page.goto('/admin/security#access');
      const box = page.getByLabel('アクセスの条件', { exact: true }).getByLabel(/ロボットからの接続を拒否する/);
      await expect(box).toBeChecked();
      await box.uncheck();
      await page.getByLabel('アクセスの条件', { exact: true }).getByRole('button', { name: '保存' }).click();
      await expect(page.getByText('保存しました')).toBeVisible();
      expect((await (await admin.get('/api/admin/security/policy', as(CHROME))).json()).block_bots).toBe(false);
    } finally {
      await setBlock(admin, true);
      await ctx.close();
    }
  });
});
