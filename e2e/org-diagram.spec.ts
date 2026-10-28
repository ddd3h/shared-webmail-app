import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { db } from './helpers/db';
import { buildOrg, type OrgIds } from './helpers/org';
import { resetOrg } from './helpers/seed';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await resetOrg(); });
test.beforeEach(async () => { await resetOrg(); });

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const handle = (page: Page, id: string, kind: 'source' | 'target') => node(page, id).locator(`.react-flow__handle.${kind}`);
const centre = async (l: Locator) => { const b = (await l.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const a = await centre(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + to.x) / 2, (a.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}
async function openDiagram(page: Page) {
  await page.goto('/org');
  await expect(page.getByTestId('org-diagram')).toBeVisible();
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
}
const unit = (id: string) => db.org_units.findUniqueOrThrow({ where: { id } });

test.describe('組織図を、図として自由に動かす（管理者）', () => {
  test.use({ storageState: AUTH.admin });
  let org: OrgIds;
  test.beforeEach(async ({ as }) => { org = await buildOrg(as); });

  test('部署がカードで出て、親子が線でつながる。カードにはメンバーと役職が出る', async ({ page }) => {
    await openDiagram(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);                 // 本社→営業部, 本社→開発部
    await expect(node(page, org.sales)).toContainText('佐藤課長');
    await expect(node(page, org.sales)).toContainText('3人');
    await expect(node(page, org.dev)).toContainText('山田部長');
  });

  test('カードをドラッグすると、好きな場所に動き、位置が保存される。再読み込みしても同じ場所。線は自動でついてくる', async ({ page }) => {
    await openDiagram(page);
    expect((await unit(org.dev)).pos_x).toBeNull();
    const before = await centre(node(page, org.dev));
    const d0 = await page.locator('path.react-flow__edge-path').evaluateAll(ps => ps.map(p => p.getAttribute('d')));
    await drag(page, node(page, org.dev).locator('h3'), { x: before.x + 120, y: before.y + 160 });
    await expect.poll(async () => (await unit(org.dev)).pos_x).not.toBeNull();
    const saved = await unit(org.dev);
    const after = await centre(node(page, org.dev));
    expect(after.x - before.x).toBeGreaterThan(80);
    expect(after.y - before.y).toBeGreaterThan(100);
    const d1 = await page.locator('path.react-flow__edge-path').evaluateAll(ps => ps.map(p => p.getAttribute('d')));
    expect(d1).not.toEqual(d0);                                                    // the line followed the card
    // reload: the card is where it was left (relative to the others)
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    const hq = await centre(node(page, org.headquarters));
    const dev = await centre(node(page, org.dev));
    const sales = await centre(node(page, org.sales));
    expect(dev.y).toBeGreaterThan(sales.y + 40);                                   // moved below the other child
    expect(saved.pos_y).not.toBeNull();
    expect(Math.abs(dev.x - hq.x)).toBeGreaterThan(0);
  });

  test('下の丸から別のカードの上の丸へ線を引くと、そのカードが下の部署になる（つなぎ直し）', async ({ page }) => {
    await openDiagram(page);
    // 営業部 → 開発部: 開発部 is put under 営業部
    const to = await centre(handle(page, org.dev, 'target'));
    await drag(page, handle(page, org.sales, 'source'), to);
    await expect.poll(async () => (await unit(org.dev)).parent_id).toBe(org.sales);
    await expect(page.getByText('「開発部」を「営業部」の下につなぎました')).toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);                // 本社→営業部, 営業部→開発部
  });

  test('輪になる線（自分の下の部署の下）はつなげない', async ({ page }) => {
    await openDiagram(page);
    const to = await centre(handle(page, org.headquarters, 'target'));             // 本社 under 開発部 (its own child)
    await drag(page, handle(page, org.dev, 'source'), to);
    await expect(page.getByText('輪になるため')).toBeVisible();
    expect((await unit(org.headquarters)).parent_id).toBeNull();
  });

  test('線の真ん中の ✕ で外すと、その部署は一番上の部署になる', async ({ page }) => {
    await openDiagram(page);
    await page.getByRole('button', { name: 'この線を外す' }).first().click();
    await expect(page.getByText('一番上の部署にしました')).toBeVisible();
    await expect.poll(async () => (await db.org_units.findMany({ where: { parent_id: null } })).length).toBe(2);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('「自動で整列」で、全部の部署が整った場所に並び、保存される', async ({ page }) => {
    await openDiagram(page);
    await page.getByRole('button', { name: '自動で整列' }).click();
    await expect.poll(async () => (await db.org_units.count({ where: { pos_x: { not: null } } }))).toBe(3);
    const hq = await unit(org.headquarters); const sales = await unit(org.sales); const dev = await unit(org.dev);
    expect(sales.pos_y).toBe(dev.pos_y);
    expect(sales.pos_y!).toBeGreaterThan(hq.pos_y!);
    expect(hq.pos_x).toBe(Math.round((sales.pos_x! + dev.pos_x!) / 2));            // the parent is centred over its children
  });

  test('「一覧」に切り替えると、これまでの一覧表示になる。選んだ表示は覚えている', async ({ page }) => {
    await openDiagram(page);
    await page.getByRole('button', { name: '一覧', exact: true }).click();
    await expect(page.getByTestId('org-diagram')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '営業部' })).toContainText('佐藤課長');
    await page.reload();
    await expect(page.getByRole('button', { name: '一覧', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '図', exact: true }).click();
    await expect(page.getByTestId('org-diagram')).toBeVisible();
  });
});

test.describe('組織図の位置を決める権限', () => {
  test('API: 管理者だけが保存できる。不正な入力・存在しない部署は400', async ({ as }) => {
    const org = await buildOrg(as);
    const logged = () => db.audit_logs.count({ where: { action_type: 'org_layout_update' } });
    const logsBefore = await logged();
    const put = (who: Parameters<typeof as>[0], data: unknown) => as(who).then(c => c.put('/api/org/layout', { data }));
    for (const who of ['sato', 'keiri', 'tanaka'] as const) expect((await put(who, { positions: [{ id: org.sales, x: 1, y: 2 }] })).status(), who).toBe(403);
    expect((await put('admin', { positions: [{ id: org.sales, x: 10.4, y: -20.6 }] })).status()).toBe(200);
    expect(await unit(org.sales)).toMatchObject({ pos_x: 10, pos_y: -21 });
    expect((await put('admin', { positions: [] })).status()).toBe(400);
    expect((await put('admin', { positions: [{ id: org.sales, x: 'a', y: 0 }] })).status()).toBe(400);
    expect((await put('admin', { positions: [{ id: org.sales, x: 1e12, y: 0 }] })).status()).toBe(400);
    expect((await put('admin', { positions: [{ id: 'nope', x: 0, y: 0 }] })).status()).toBe(400);
    expect((await put('admin', { positions: [{ id: org.sales, x: 0, y: 0 }, { id: org.sales, x: 1, y: 1 }] })).status()).toBe(400);
    expect(await unit(org.sales)).toMatchObject({ pos_x: 10, pos_y: -21 });       // the refused ones changed nothing
    expect(await logged()).toBe(logsBefore + 1);                                   // only the one that worked is logged
  });

  test('管理者以外にも図は見えるが、動かす・つなぐ・外すの操作は出ない。位置は管理者が決めたとおり', async ({ browser, as }) => {
    const org = await buildOrg(as);
    await (await as('admin')).put('/api/org/layout', { data: { positions: [{ id: org.headquarters, x: 0, y: 0 }, { id: org.sales, x: -400, y: 400 }, { id: org.dev, x: 400, y: 400 }] } });
    const ctx = await browser.newContext({ storageState: AUTH.tanaka, locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await openDiagram(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.getByRole('button', { name: '自動で整列' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'この線を外す' })).toHaveCount(0);
    await expect(page.locator('.react-flow__node.draggable')).toHaveCount(0);
    const sales = await centre(node(page, org.sales)); const dev = await centre(node(page, org.dev));
    expect(dev.x).toBeGreaterThan(sales.x + 200);                                  // 営業部 on the left, 開発部 on the right, as saved
    await drag(page, node(page, org.sales).locator('h3'), { x: sales.x + 150, y: sales.y + 150 });
    expect((await unit(org.sales)).pos_x).toBe(-400);                              // nothing was saved
    await ctx.close();
  });
});

test.describe('スマホ', () => {
  test('図が画面の幅に収まり、はみ出さない。「図」「一覧」を切り替えられる', async ({ browser, as }) => {
    await buildOrg(as);
    const ctx = await browser.newContext({ storageState: AUTH.admin, locale: 'ja-JP', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await openDiagram(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    const box = (await page.getByTestId('org-diagram').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '一覧', exact: true }).click();
    await expect(page.getByRole('region', { name: '営業部' })).toBeVisible();
    await ctx.close();
  });
});
