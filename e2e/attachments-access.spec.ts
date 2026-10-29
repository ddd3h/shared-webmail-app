import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { PDF, makePayment, makeVendor, postClaim } from './helpers/factories';
import { buildOrg } from './helpers/org';
import { resetOrg, resetTransfers } from './helpers/seed';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await resetOrg(); await resetTransfers(); });
test.beforeEach(async () => { await resetOrg(); await resetTransfers(); });

const PNG = { name: '切符.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') };
const HEIC = { name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('0000001866747970686569630000000068656963', 'hex') };

type As = (r: any) => Promise<import('@playwright/test').APIRequestContext>;
async function receiptOf(as: As, file = PDF, o: Record<string, string> = {}, role: 'sato' | 'tanaka' = 'sato') {
  const res = await postClaim(await as(role), o, [file]);
  expect(res.status()).toBe(201);
  const id = (await res.json()).id as string;
  return { id, rid: (await db.expense_receipts.findFirstOrThrow({ where: { claim_id: id } })).id };
}

test.describe('領収書: ブラウザで開く・見られる人', () => {
  test('画像とPDFは、ダウンロードではなくブラウザの中で表示される。ファイルの種類は取り違えられず、キャッシュもされない', async ({ as }) => {
    for (const [file, type] of [[PDF, 'application/pdf'], [PNG, 'image/png']] as const) {
      const { rid } = await receiptOf(as, file);
      const res = await (await as('sato')).get(`/api/expenses/receipts/${rid}`);
      expect(res.status()).toBe(200);
      const h = res.headers();
      expect(h['content-type']).toBe(type);
      expect(h['content-disposition']).toMatch(/^inline; filename\*=UTF-8''/);
      expect(h['content-disposition']).toContain(encodeURIComponent(file.name));
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['cache-control']).toBe('private, no-store');
      expect(Number(h['content-length'])).toBe(file.buffer.length);
      expect((await res.body()).equals(file.buffer)).toBe(true);
    }
  });

  test('ブラウザで表示できない種類（HEIC）だけは、ダウンロードになる', async ({ as }) => {
    const { rid } = await receiptOf(as, HEIC);
    const res = await (await as('sato')).get(`/api/expenses/receipts/${rid}`);
    expect(res.headers()['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('見られるのは、本人・経理・管理者と、その経費の承認者（選んだ部門で承認の権限のある人）。ほかの人・別の部門の承認者・未ログインは見られない', async ({ as, anon }) => {
    const org = await buildOrg(as);
    const { rid } = await receiptOf(as, PDF, { unit_id: org.sales }, 'tanaka');          // 田中（営業部）の経費
    const status = async (who: Parameters<typeof as>[0]) => (await (await as(who)).get(`/api/expenses/receipts/${rid}`)).status();
    for (const who of ['tanaka', 'keiri', 'admin', 'sato'] as const) expect(await status(who), who).toBe(200);   // 佐藤 = 営業部の課長（承認者）
    for (const who of ['yamada', 'suzuki', 'guest'] as const) expect(await status(who), who).toBe(403);          // 山田 = 開発部の部長（別の部門）
    expect((await anon.get(`/api/expenses/receipts/${rid}`, { maxRedirects: 0 })).status()).toBe(307);
    expect((await (await as('admin')).get('/api/expenses/receipts/nope')).status()).toBe(404);
  });

  test('ファイルの置き場を直接指すURLでは取れない（権限のあるAPI経由だけ）', async ({ as, anon }) => {
    const { rid } = await receiptOf(as);
    const key = (await db.expense_receipts.findUniqueOrThrow({ where: { id: rid } })).storage_key;
    for (const url of [`/${key}`, `/${key.replace(/\\/g, '/')}`, `/storage/attachments/${key.split('/').pop()}`, `/api/${key}`]) {
      const res = await (await as('sato')).get(url, { maxRedirects: 0 });
      expect([404, 307, 308]).toContain(res.status());
      expect((await anon.get(url, { maxRedirects: 0 })).status(), url).not.toBe(200);
    }
  });

  test('承認の画面に領収書のリンクが出て、新しいタブでそのまま開ける（ダウンロードされない）', async ({ browser, as }) => {
    const org = await buildOrg(as);
    await receiptOf(as, PDF, { unit_id: org.sales, title: '承認画面の経費' }, 'tanaka');
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/approvals');
    const link = page.getByRole('link', { name: /receipt\.pdf/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    expect(await link.getAttribute('download')).toBeNull();
    // it opens in another tab: the answer is seen on the browser context
    const [res] = await Promise.all([ctx.waitForEvent('response', r => r.url().includes('/api/expenses/receipts/')), link.click()]);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toMatch(/^inline;/);
    await ctx.close();
  });

  test('申請者の画面の領収書も、新しいタブで開く（ダウンロードの指定が付いていない）', async ({ browser, as }) => {
    await receiptOf(as, PDF, { title: '自分の経費' });
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/expenses');
    await page.getByRole('button', { name: /自分の経費/ }).click();
    const link = page.getByRole('link', { name: /receipt\.pdf/ });
    await expect(link).toHaveAttribute('target', '_blank');
    expect(await link.getAttribute('download')).toBeNull();
    await ctx.close();
  });
});

test.describe('振込申請の請求書: ブラウザで開く・見られる人', () => {
  async function invoice(as: As) {
    const vendor = await makeVendor({ name: '株式会社テスト商事', verified: true });
    const res = await (await as('sato')).post('/api/payments', { multipart: { vendor_id: vendor.id, title: '請求書つき', amount: '50000', due_date: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10), file: PDF } });
    expect(res.status()).toBe(201);
    const doc = await db.payment_documents.findFirstOrThrow({ where: { request_id: (await res.json()).id } });
    return doc.id;
  }

  test('本人・経理・管理者は、ブラウザの中で開ける。ほかの人・承認者の役職の人・未ログインは開けない', async ({ as, anon }) => {
    await buildOrg(as);
    const did = await invoice(as);
    const get = async (who: Parameters<typeof as>[0]) => (await as(who)).get(`/api/payments/documents/${did}`);
    for (const who of ['sato', 'keiri', 'admin'] as const) {
      const res = await get(who);
      expect(res.status(), who).toBe(200);
      expect(res.headers()['content-disposition']).toMatch(/^inline;/);
      expect(res.headers()['x-content-type-options']).toBe('nosniff');
      expect(res.headers()['cache-control']).toBe('private, no-store');
    }
    for (const who of ['tanaka', 'yamada', 'suzuki'] as const) expect((await get(who)).status(), who).toBe(403);
    expect((await anon.get(`/api/payments/documents/${did}`, { maxRedirects: 0 })).status()).toBe(307);
    expect((await (await as('admin')).get('/api/payments/documents/nope')).status()).toBe(404);
  });

  test('画面の請求書のリンクは、新しいタブで開く', async ({ browser, as }) => {
    await invoice(as);
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/payments');
    await page.getByRole('button', { name: /請求書つき/ }).click();
    const link = page.getByRole('link', { name: /receipt\.pdf/ });
    await expect(link).toHaveAttribute('target', '_blank');
    expect(await link.getAttribute('download')).toBeNull();
    await ctx.close();
  });
});
