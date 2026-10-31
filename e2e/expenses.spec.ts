import { test, expect, uniq } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { HTML_FILE, PDF, PNG, SVG_FILE, makeClaim, makePayslip, makeTrip, postClaim } from './helpers/factories';
import { resetExpenses, resetPayslips, resetTrips } from './helpers/seed';
import { field, today } from './helpers/ui';

test.beforeEach(async () => { await resetTrips(); await resetExpenses(); await resetPayslips(); });
test.afterEach(async () => { await db.users.updateMany({ where: { id: USERS.admin2.id }, data: { role: 'admin' } }); });

const month = () => today().slice(0, 7);

test.describe('経費の申請（画面）', () => {
  test.use({ storageState: AUTH.sato });

  test('領収書つきで申請すると、承認待ちとして一覧に出る', async ({ page }) => {
    const title = uniq('A社訪問の交通費');
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await page.getByPlaceholder(/A社訪問/).fill(title);
    await page.locator('input[type=number]').fill('1480');
    await page.setInputFiles('input[type=file]', PDF);
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('申請しました')).toBeVisible();
    const card = page.getByRole('button', { name: new RegExp(title) });
    await expect(card).toContainText('¥1,480');
    await expect(card).toContainText('承認待ち');
    await expect(card).toContainText('立替');
    const claim = await db.expense_claims.findFirst({ where: { title }, include: { receipts: true } });
    expect(claim).toMatchObject({ user_id: USERS.sato.id, amount: 1480, status: 'pending', payment_method: 'personal' });
    expect(claim!.receipts).toHaveLength(1);
  });

  test('会社負担を選ぶと「承認後に返金対象」の案内が消える', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await expect(page.getByText('承認後、立替金の返金対象になります。')).toBeVisible();
    await field(page, '支払方法').selectOption('company');
    await expect(page.getByText('承認後、立替金の返金対象になります。')).toHaveCount(0);
  });

  test('金額が空のまま申請するとエラーになり、何も作られない', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await page.getByPlaceholder(/A社訪問/).fill(uniq('金額なし'));
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('保存に失敗しました')).toBeVisible();
    expect(await db.expense_claims.count()).toBe(0);
  });

  test('画像以外のファイル（HTML）を添付するとエラーになる', async ({ page }) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '＋ 経費を申請' }).click();
    await page.getByPlaceholder(/A社訪問/).fill(uniq('不正な添付'));
    await page.locator('input[type=number]').fill('500');
    await page.setInputFiles('input[type=file]', HTML_FILE);
    await page.getByRole('button', { name: '申請する' }).click();
    await expect(page.getByText('領収書は画像かPDFのみ添付できます')).toBeVisible();
    expect(await db.expense_claims.count()).toBe(0);
  });

  test('承認待ちの申請は編集でき、取り下げると消える', async ({ page }) => {
    const c = await makeClaim({ title: '編集前の件名', amount: 800 });
    await page.goto('/expenses');
    await page.getByRole('button', { name: /編集前の件名/ }).click();
    await page.getByRole('button', { name: '編集', exact: true }).click();
    await page.getByPlaceholder(/A社訪問/).fill('編集後の件名');
    await page.locator('input[type=number]').fill('900');
    await page.getByRole('button', { name: '更新して申請' }).click();
    await expect(page.getByText('申請を更新しました')).toBeVisible();
    expect(await db.expense_claims.findUnique({ where: { id: c.id } })).toMatchObject({ title: '編集後の件名', amount: 900, status: 'pending' });

    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '取り下げ' }).click();
    await expect(page.getByText('申請はありません')).toBeVisible();
    expect(await db.expense_claims.count()).toBe(0);
  });

  test('却下された申請は理由が見え、修正して再申請すると承認待ちに戻る', async ({ page }) => {
    const c = await makeClaim({ title: '宛名違いの領収書', status: 'rejected', comment: '宛名が違います' });
    await page.goto('/expenses');
    await expect(page.getByRole('button', { name: /宛名違いの領収書/ })).toContainText('却下');
    await page.getByRole('button', { name: /宛名違いの領収書/ }).click();
    await expect(page.getByText('宛名が違います')).toBeVisible();
    await page.getByRole('button', { name: '修正して再申請' }).first().click();
    await page.getByRole('button', { name: '更新して申請' }).click();
    await expect(page.getByText('申請を更新しました')).toBeVisible();
    expect(await db.expense_claims.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'pending', review_comment: null, reviewed_by_id: null });
  });

  test('承認済みの申請には編集・取り下げの操作が出ない', async ({ page }) => {
    await makeClaim({ title: '承認済みの申請', status: 'approved' });
    await page.goto('/expenses');
    await page.getByRole('button', { name: /承認済みの申請/ }).click();
    await expect(page.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '取り下げ' })).toHaveCount(0);
  });

  test('状態の絞り込み（承認待ち／返金待ち／返金済／却下）が効く', async ({ page }) => {
    await makeClaim({ title: '申請P', status: 'pending' });
    await makeClaim({ title: '申請A', status: 'approved' });
    await makeClaim({ title: '申請S', status: 'paid' });
    await makeClaim({ title: '申請R', status: 'rejected' });
    await makeClaim({ title: '申請C', status: 'approved', method: 'company' });
    await page.goto('/expenses');
    const only = async (pill: string, titles: string[]) => {
      await page.getByRole('button', { name: pill, exact: true }).click();
      for (const t of ['申請P', '申請A', '申請S', '申請R', '申請C']) {
        const loc = page.getByRole('button', { name: new RegExp(`${t}$|${t}\\s`) });
        if (titles.includes(t)) await expect(loc.first()).toBeVisible(); else await expect(loc).toHaveCount(0);
      }
    };
    await only('承認待ち', ['申請P']);
    await only('返金待ち', ['申請A']);
    await only('返金済', ['申請S']);
    await only('却下', ['申請R']);
    await only('すべて', ['申請P', '申請A', '申請S', '申請R', '申請C']);
  });

  test('上部の集計: 承認待ち・返金待ち・返金済みの金額', async ({ page }) => {
    await makeClaim({ status: 'pending', amount: 1000 });
    await makeClaim({ status: 'approved', amount: 2500 });
    await makeClaim({ status: 'approved', amount: 700, method: 'company' }); // 会社負担は返金待ちに数えない
    await makeClaim({ status: 'paid', amount: 4400 });
    await makeClaim({ status: 'rejected', amount: 9999 });
    await page.goto('/expenses');
    await expect(page.getByText('承認待ち', { exact: true }).first().locator('..')).toContainText('¥1,000');
    await expect(page.getByText('返金待ちの立替金').locator('..')).toContainText('¥2,500');
    await expect(page.getByText('返金済みの合計').locator('..')).toContainText('¥4,400');
  });

  test('他の人の申請は一覧に出ない', async ({ page }) => {
    await makeClaim({ role: 'tanaka', title: '田中の経費' });
    await makeClaim({ role: 'sato', title: '佐藤の経費' });
    await page.goto('/expenses');
    await expect(page.getByRole('button', { name: /佐藤の経費/ })).toBeVisible();
    await expect(page.getByText('田中の経費')).toHaveCount(0);
  });

  test('タイトルのHTMLは文字として表示される', async ({ page }) => {
    await makeClaim({ title: '<img src=x onerror="window.__x=1">' });
    await page.goto('/expenses');
    await expect(page.getByText('<img src=x', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__x)).toBeUndefined();
  });
});

test.describe('経費の申請（API・入力検証）', () => {
  for (const [label, o] of [
    ['金額が0', { amount: '0' }],
    ['金額が負', { amount: '-100' }],
    ['金額が小数', { amount: '10.5' }],
    ['金額が1億円超', { amount: '100000001' }],
    ['金額が文字', { amount: 'abc' }],
    ['勘定科目が一覧にない', { category: '遊興費' }],
    ['支払方法が不正', { payment_method: 'credit' }],
    ['日付が不正', { expense_date: '2026-02-30' }],
    ['日付の形式が不正', { expense_date: '10/20/2026' }],
    ['件名が空', { title: '' }],
    ['件名が201文字', { title: 'あ'.repeat(201) }],
    ['備考が2001文字', { description: 'a'.repeat(2001) }],
  ] as const) {
    test(`申請: ${label} は400`, async ({ as }) => {
      const res = await postClaim(await as('sato'), o);
      expect(res.status()).toBe(400);
      expect(await db.expense_claims.count()).toBe(0);
    });
  }

  for (const category of ['交通費', '出張・宿泊費', '交際費', '会議費', '消耗品費', '通信費', '書籍・研修費', 'その他']) {
    test(`勘定科目「${category}」で申請できる`, async ({ as }) => {
      expect((await postClaim(await as('sato'), { category })).status()).toBe(201);
    });
  }

  test('金額の上限ちょうど（1億円）は通る', async ({ as }) => {
    expect((await postClaim(await as('sato'), { amount: '100000000' })).status()).toBe(201);
  });

  test('役員・業務委託・管理者も申請できる', async ({ as }) => {
    for (const role of ['yamada', 'suzuki', 'admin'] as const) expect((await postClaim(await as(role))).status()).toBe(201);
  });

  test('領収書: PDF・PNGは添付でき、HTML・SVGは400', async ({ as }) => {
    const c = await as('sato');
    expect((await postClaim(c, {}, [PDF])).status()).toBe(201);
    expect((await postClaim(c, {}, [PNG])).status()).toBe(201);
    expect((await postClaim(c, {}, [HTML_FILE])).status()).toBe(400);
    expect((await postClaim(c, {}, [SVG_FILE])).status()).toBe(400);
    expect(await db.expense_claims.count()).toBe(2);
  });

  test('領収書: 5枚まで。6枚は400', async ({ as }) => {
    const c = await as('sato');
    expect((await postClaim(c, {}, Array.from({ length: 5 }, (_, i) => ({ ...PNG, name: `r${i}.png` })))).status()).toBe(201);
    expect((await postClaim(c, {}, Array.from({ length: 6 }, (_, i) => ({ ...PNG, name: `r${i}.png` })))).status()).toBe(400);
  });

  test('領収書: 10MBを超えるファイルは400', async ({ as }) => {
    const big = { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20) };
    expect((await postClaim(await as('sato'), {}, [big])).status()).toBe(400);
  });

  test('申請後に領収書を追加でき、合計5枚を超えると400', async ({ as }) => {
    const c = await as('sato');
    const id = (await (await postClaim(c, {}, [PNG])).json()).id;
    const add = (n: number) => c.post(`/api/expenses/${id}/receipts`, { multipart: { file: { ...PNG, name: `n${n}.png` } } });
    for (let i = 0; i < 4; i++) expect((await add(i)).status()).toBe(201);
    expect((await add(9)).status()).toBe(400);
    expect(await db.expense_receipts.count({ where: { claim_id: id } })).toBe(5);
  });

  test('承認済みの申請には領収書を追加できない（409）。他人の申請も403', async ({ as }) => {
    const approved = await makeClaim({ status: 'approved' });
    expect((await (await as('sato')).post(`/api/expenses/${approved.id}/receipts`, { multipart: { file: PNG } })).status()).toBe(409);
    const pending = await makeClaim({ status: 'pending' });
    expect((await (await as('tanaka')).post(`/api/expenses/${pending.id}/receipts`, { multipart: { file: PNG } })).status()).toBe(403);
  });
});

test.describe('経費の編集・取り下げ（API・権限）', () => {
  const body = { expense_date: today(), category: '交通費', title: '更新', amount: 500, payment_method: 'personal' };

  test('他人の申請は編集も取り下げもできない（403）', async ({ as }) => {
    const c = await makeClaim({ role: 'sato' });
    expect((await (await as('tanaka')).patch(`/api/expenses/${c.id}`, { data: body })).status()).toBe(403);
    expect((await (await as('tanaka')).delete(`/api/expenses/${c.id}`)).status()).toBe(403);
  });

  for (const status of ['approved', 'paid'] as const) {
    test(`${status === 'approved' ? '承認済' : '返金済'}の申請は編集できない（409）`, async ({ as }) => {
      const c = await makeClaim({ status });
      expect((await (await as('sato')).patch(`/api/expenses/${c.id}`, { data: body })).status()).toBe(409);
    });
  }

  test('承認済み・返金済みの申請は本人でも取り下げできない', async ({ as }) => {
    for (const status of ['approved', 'paid'] as const) {
      const c = await makeClaim({ status });
      expect((await (await as('sato')).delete(`/api/expenses/${c.id}`)).status()).toBe(409);
    }
  });

  test('管理者は承認済みの申請を削除できるが、返金済みは削除できない', async ({ as }) => {
    const approved = await makeClaim({ status: 'approved' });
    const paid = await makeClaim({ status: 'paid' });
    expect((await (await as('admin')).delete(`/api/expenses/${approved.id}`)).status()).toBe(200);
    expect((await (await as('admin')).delete(`/api/expenses/${paid.id}`)).status()).toBe(409);
  });

  test('存在しない申請は404', async ({ as }) => {
    expect((await (await as('sato')).patch('/api/expenses/nope', { data: body })).status()).toBe(404);
    expect((await (await as('sato')).delete('/api/expenses/nope')).status()).toBe(404);
  });

  test('編集で不正な値を送ると400で、元の値が残る', async ({ as }) => {
    const c = await makeClaim({ amount: 700 });
    expect((await (await as('sato')).patch(`/api/expenses/${c.id}`, { data: { ...body, amount: 0 } })).status()).toBe(400);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.amount).toBe(700);
  });
});

test.describe('経費の一覧（API・権限）', () => {
  test('一般ユーザーは scope=all が403。userId を指定しても自分の分だけ', async ({ as }) => {
    await makeClaim({ role: 'tanaka', title: '田中の経費' });
    await makeClaim({ role: 'sato', title: '佐藤の経費' });
    const c = await as('sato');
    expect((await c.get('/api/expenses?scope=all')).status()).toBe(403);
    const items = (await (await c.get(`/api/expenses?userId=${USERS.tanaka.id}`)).json()).items;
    expect(items.map((i: { title: string }) => i.title)).toEqual(['佐藤の経費']);
  });

  test('管理者は全員分を見られ、人・状態・月で絞り込める', async ({ as }) => {
    await makeClaim({ role: 'tanaka', title: '田中', status: 'approved', date: '2020-05-10' });
    await makeClaim({ role: 'sato', title: '佐藤', status: 'pending' });
    const c = await as('admin');
    expect((await (await c.get('/api/expenses?scope=all')).json()).items).toHaveLength(2);
    expect((await (await c.get(`/api/expenses?scope=all&userId=${USERS.tanaka.id}`)).json()).items).toHaveLength(1);
    expect((await (await c.get('/api/expenses?scope=all&status=pending')).json()).items).toHaveLength(1);
    expect((await (await c.get('/api/expenses?scope=all&month=2020-05')).json()).items.map((i: { title: string }) => i.title)).toEqual(['田中']);
  });

  for (const q of ['status=unknown', 'month=2026-13', 'month=abc']) {
    test(`不正なクエリ ${q} は400`, async ({ as }) => {
      expect((await (await as('admin')).get(`/api/expenses?scope=all&${q}`)).status()).toBe(400);
    });
  }

  test('集計は絞り込みに関係なく全体の金額を返す', async ({ as }) => {
    await makeClaim({ status: 'pending', amount: 100 });
    await makeClaim({ status: 'approved', amount: 200 });
    await makeClaim({ status: 'paid', amount: 400 });
    const body = await (await (await as('sato')).get('/api/expenses?status=paid')).json();
    expect(body.items).toHaveLength(1);
    expect(body.summary).toMatchObject({ pending: { count: 1, amount: 100 }, to_reimburse: { count: 1, amount: 200 }, paid: { count: 1, amount: 400 } });
  });
});

test.describe('領収書のダウンロード権限', () => {
  async function claimWithReceipt(as: (r: any) => Promise<any>) {
    const id = (await (await postClaim(await as('sato'), {}, [PDF])).json()).id;
    const rid = (await db.expense_receipts.findFirst({ where: { claim_id: id } }))!.id;
    return { id, rid };
  }

  test('本人と管理者は取得でき、ブラウザでそのまま表示される形で返る（ダウンロードにならない）', async ({ as }) => {
    const { rid } = await claimWithReceipt(as);
    for (const role of ['sato', 'admin'] as const) {
      const res = await (await as(role)).get(`/api/expenses/receipts/${rid}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-disposition']).toMatch(/^inline;/);
      expect(res.headers()['x-content-type-options']).toBe('nosniff');
      expect(res.headers()['content-type']).toBe('application/pdf');
    }
  });

  test('他のユーザー・未ログインは取得できない', async ({ as, anon }) => {
    const { rid } = await claimWithReceipt(as);
    expect((await (await as('tanaka')).get(`/api/expenses/receipts/${rid}`)).status()).toBe(403);
    expect((await (await as('suzuki')).get(`/api/expenses/receipts/${rid}`)).status()).toBe(403);
    expect((await anon.get(`/api/expenses/receipts/${rid}`, { maxRedirects: 0 })).status()).toBe(401);
  });

  test('存在しない領収書は404', async ({ as }) => {
    expect((await (await as('admin')).get('/api/expenses/receipts/nope')).status()).toBe(404);
  });

  test('領収書は本人が承認待ちの間だけ削除できる', async ({ as }) => {
    const { id, rid } = await claimWithReceipt(as);
    expect((await (await as('tanaka')).delete(`/api/expenses/receipts/${rid}`)).status()).toBe(403);
    expect((await (await as('admin')).delete(`/api/expenses/receipts/${rid}`)).status()).toBe(403);
    await db.expense_claims.update({ where: { id }, data: { status: 'approved' } });
    expect((await (await as('sato')).delete(`/api/expenses/receipts/${rid}`)).status()).toBe(409);
    await db.expense_claims.update({ where: { id }, data: { status: 'pending' } });
    expect((await (await as('sato')).delete(`/api/expenses/receipts/${rid}`)).status()).toBe(200);
    expect(await db.expense_receipts.count({ where: { claim_id: id } })).toBe(0);
  });

  test('申請を取り下げると領収書の行も消える', async ({ as }) => {
    const { id } = await claimWithReceipt(as);
    expect((await (await as('sato')).delete(`/api/expenses/${id}`)).status()).toBe(200);
    expect(await db.expense_receipts.count({ where: { claim_id: id } })).toBe(0);
  });
});

test.describe('承認・却下（API）', () => {
  const review = async (c: import('@playwright/test').APIRequestContext, id: string, data: object) => c.post(`/api/expenses/${id}/review`, { data });

  test('管理者以外は承認できない', async ({ as }) => {
    const c = await makeClaim({});
    expect((await review(await as('sato'), c.id, { action: 'approve' })).status()).toBe(403);
    expect((await review(await as('tanaka'), c.id, { action: 'approve' })).status()).toBe(403);
  });

  test('承認すると状態・承認者・日時が記録され、監査ログに残る', async ({ as }) => {
    const c = await makeClaim({});
    expect((await review(await as('admin'), c.id, { action: 'approve', comment: 'OK' })).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'approved', reviewed_by_id: USERS.admin.id, review_comment: 'OK' });
    expect(await db.audit_logs.count({ where: { action_type: 'expense_approve', target_id: c.id } })).toBe(1);
  });

  test('却下はコメント必須。コメントなしは400で、状態は変わらない', async ({ as }) => {
    const c = await makeClaim({});
    expect((await review(await as('admin'), c.id, { action: 'reject' })).status()).toBe(400);
    expect((await review(await as('admin'), c.id, { action: 'reject', comment: '   ' })).status()).toBe(400);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.status).toBe('pending');
    expect((await review(await as('admin'), c.id, { action: 'reject', comment: '領収書を添付してください' })).status()).toBe(200);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.status).toBe('rejected');
  });

  test('不正なactionは400、処理済みの申請は409、存在しない申請は404', async ({ as }) => {
    const c = await makeClaim({});
    const admin = await as('admin');
    expect((await review(admin, c.id, { action: 'maybe' })).status()).toBe(400);
    await review(admin, c.id, { action: 'approve' });
    expect((await review(admin, c.id, { action: 'approve' })).status()).toBe(409);
    expect((await review(admin, c.id, { action: 'reject', comment: 'x' })).status()).toBe(409);
    expect((await review(admin, 'nope', { action: 'approve' })).status()).toBe(404);
  });

  test('管理者が複数いるとき、自分の申請は承認できず、別の管理者なら承認できる', async ({ as }) => {
    const c = await makeClaim({ role: 'admin', title: '管理者の経費' });
    expect((await review(await as('admin'), c.id, { action: 'approve' })).status()).toBe(403);
    expect((await review(await as('admin2'), c.id, { action: 'approve' })).status()).toBe(200);
  });

  test('管理者が1人だけなら、自分の申請を承認できる', async ({ as }) => {
    await db.users.update({ where: { id: USERS.admin2.id }, data: { role: 'user' } });
    const c = await makeClaim({ role: 'admin' });
    expect((await review(await as('admin'), c.id, { action: 'approve' })).status()).toBe(200);
  });

  test('二人が同時に承認しても、承認は1回だけ成立する', async ({ as }) => {
    const c = await makeClaim({});
    const [a, b] = await Promise.all([review(await as('admin'), c.id, { action: 'approve' }), review(await as('admin2'), c.id, { action: 'approve' })]);
    expect([a.status(), b.status()].sort()).toEqual([200, 409]);
  });
});

test.describe('承認・返金（画面）', () => {
  test.use({ storageState: AUTH.admin });
  const adminTab = async (page: import('@playwright/test').Page) => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: '承認・返金' }).click();
  };

  test('承認待ちが開いた状態で並び、承認すると一覧から消える', async ({ page }) => {
    await makeClaim({ title: '承認する経費', amount: 1234 });
    await adminTab(page);
    const card = page.locator('div.rounded-xl', { hasText: '承認する経費' });
    await expect(card.getByRole('button', { name: '承認', exact: true })).toBeVisible();
    await card.getByRole('button', { name: '承認', exact: true }).click();
    await expect(page.getByText('承認しました')).toBeVisible();
    await expect(page.getByText('承認する経費')).toHaveCount(0);
  });

  test('却下は理由を入力するまで「却下する」が押せず、理由が申請者に表示される', async ({ page, browser }) => {
    const c = await makeClaim({ title: '却下する経費' });
    await adminTab(page);
    await page.locator('div.rounded-xl', { hasText: '却下する経費' }).getByRole('button', { name: '却下…' }).click();
    const dialog = page.locator('div.fixed');
    await expect(dialog.getByRole('button', { name: '却下する', exact: true })).toBeDisabled();
    await page.locator('textarea').fill('宛名が違います');
    await dialog.getByRole('button', { name: '却下する', exact: true }).click();
    await expect(page.getByText('却下しました')).toBeVisible();
    expect(await db.expense_claims.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'rejected', review_comment: '宛名が違います' });
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const p2 = await ctx.newPage();
    await p2.goto('/expenses');
    await p2.getByRole('button', { name: /却下する経費/ }).click();
    await expect(p2.getByText('宛名が違います')).toBeVisible();
    await ctx.close();
  });

  test('自分の申請には案内が出て、他の管理者が承認する必要がある', async ({ page }) => {
    await makeClaim({ role: 'admin', title: '管理者本人の経費' });
    await adminTab(page);
    const card = page.locator('div.rounded-xl', { hasText: '管理者本人の経費' });
    await expect(card.getByText('自分の申請です')).toBeVisible();
    await card.getByRole('button', { name: '承認', exact: true }).click();
    await expect(page.getByText('自分の申請は他の管理者が承認してください')).toBeVisible();
  });

  test('返金待ちに人ごとの返金額が出る', async ({ page }) => {
    await makeClaim({ role: 'sato', status: 'approved', amount: 3000 });
    await makeClaim({ role: 'sato', status: 'approved', amount: 2000 });
    await makeClaim({ role: 'tanaka', status: 'approved', amount: 800 });
    await adminTab(page);
    await page.getByRole('button', { name: '返金待ち', exact: true }).click();
    await expect(page.getByText('人ごとの返金額')).toBeVisible();
    await expect(page.getByRole('button', { name: /佐藤（2件）/ })).toContainText('¥5,000');
    await expect(page.getByRole('button', { name: /田中（1件）/ })).toContainText('¥800');
  });

  test('人ごとのボタンで絞り込める', async ({ page }) => {
    await makeClaim({ role: 'sato', status: 'approved', title: '佐藤の立替' });
    await makeClaim({ role: 'tanaka', status: 'approved', title: '田中の立替' });
    await adminTab(page);
    await page.getByRole('button', { name: '返金待ち', exact: true }).click();
    await page.getByRole('button', { name: /佐藤（1件）/ }).click();
    await expect(page.getByText('佐藤の立替')).toBeVisible();
    await expect(page.getByText('田中の立替')).toHaveCount(0);
  });

  test('「別途返金済にする」を選ぶと、すぐ返金済になり、返金日とメモが残る', async ({ page }) => {
    const a = await makeClaim({ status: 'approved', amount: 1000 });
    const b = await makeClaim({ status: 'approved', amount: 2000 });
    await adminTab(page);
    await page.getByRole('button', { name: '返金待ち', exact: true }).click();
    await page.getByText('すべて選択').click();
    await expect(page.getByText('選択中 2件')).toBeVisible();
    await page.getByRole('button', { name: '返金する…' }).click();
    await page.getByText('別途返金済にする').click();
    await field(page, '返金日').fill('2026-10-25');
    await field(page, 'メモ').fill('現金で精算');
    await page.locator('div.fixed').getByRole('button', { name: '返金済にする' }).click();
    await expect(page.getByText('2件を返金済にしました')).toBeVisible();
    for (const id of [a.id, b.id]) {
      const row = await db.expense_claims.findUnique({ where: { id } });
      expect(row).toMatchObject({ status: 'paid', reimburse_note: '現金で精算', reimbursed_by_id: USERS.admin.id });
      expect(row!.reimbursed_at!.toISOString().slice(0, 10)).toBe('2026-10-25');
    }
  });

  test('「給与明細に合算する」を選ぶと、その人の明細に立替金精算の行ができる', async ({ page }) => {
    await makePayslip({ role: 'sato', title: '給与', items: [{ kind: 'earning', label: '基本給', amount: 300000 }] });
    const c1 = await makeClaim({ role: 'sato', status: 'approved', amount: 9800 });
    const c2 = await makeClaim({ role: 'sato', status: 'approved', amount: 5500 });
    await adminTab(page);
    await page.getByRole('button', { name: '返金待ち', exact: true }).click();
    await page.getByText('すべて選択').click();
    await page.getByRole('button', { name: '返金する…' }).click();
    await expect(page.getByText('給与明細に合算する').first()).toBeVisible();
    await field(page, '合算する明細の対象月').fill(month());
    await page.locator('div.fixed').getByRole('button', { name: '給与明細に合算する' }).click();
    await expect(page.getByText(/2件を\d+月分の給与明細に合算しました/)).toBeVisible();
    const slip = await db.payslips.findFirst({ where: { user_id: USERS.sato.id }, include: { items: true } });
    const sys = slip!.items.find(i => i.system_key === 'expense_reimbursement');
    expect(sys).toMatchObject({ kind: 'earning', amount: 15300, label: '立替金精算（2件）' });
    for (const c of [c1, c2]) expect(await db.expense_claims.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'approved', payslip_id: slip!.id });
  });
});

test.describe('返金処理（API）', () => {
  const reimburse = async (c: import('@playwright/test').APIRequestContext, data: object) => c.post('/api/expenses/reimburse', { data });

  test('管理者以外は返金処理できない', async ({ as }) => {
    const c = await makeClaim({ status: 'approved' });
    expect((await reimburse(await as('sato'), { ids: [c.id] })).status()).toBe(403);
  });

  test('承認済みの立替だけが対象で、承認待ち・会社負担・返金済みはスキップされる', async ({ as }) => {
    const ok = await makeClaim({ status: 'approved' });
    const pending = await makeClaim({ status: 'pending' });
    const company = await makeClaim({ status: 'approved', method: 'company' });
    const paid = await makeClaim({ status: 'paid' });
    const res = await reimburse(await as('admin'), { ids: [ok.id, pending.id, company.id, paid.id, 'nope'] });
    expect(await res.json()).toEqual({ reimbursed: 1, attached: 0, skipped: 4 });
    expect((await db.expense_claims.findUnique({ where: { id: pending.id } }))!.status).toBe('pending');
    expect((await db.expense_claims.findUnique({ where: { id: company.id } }))!.status).toBe('approved');
  });

  for (const [label, data] of [
    ['idsが空', { ids: [] }],
    ['idsがない', {}],
    ['返金日が不正', { ids: ['x'], paid_date: '2026-02-30' }],
    ['モードが不正', { ids: ['x'], mode: 'bank' }],
    ['合算モードで対象月がない', { ids: ['x'], mode: 'payslip' }],
    ['合算モードで対象月が不正', { ids: ['x'], mode: 'payslip', pay_month: '2026-13' }],
  ] as const) {
    test(`不正な指定: ${label} は400`, async ({ as }) => {
      expect((await reimburse(await as('admin'), data)).status()).toBe(400);
    });
  }

  test('同じ申請を二重に返金処理しても、二度目はスキップされる', async ({ as }) => {
    const c = await makeClaim({ status: 'approved' });
    const admin = await as('admin');
    expect((await (await reimburse(admin, { ids: [c.id] })).json()).reimbursed).toBe(1);
    expect(await (await reimburse(admin, { ids: [c.id] })).json()).toEqual({ reimbursed: 0, attached: 0, skipped: 1 });
  });

  test('合算: 明細がなければ「立替金精算」の明細を新しく作る', async ({ as }) => {
    const c = await makeClaim({ status: 'approved', amount: 4400 });
    const res = await reimburse(await as('admin'), { ids: [c.id], mode: 'payslip', pay_month: month() });
    expect(await res.json()).toEqual({ reimbursed: 0, attached: 1, skipped: 0 });
    const slip = await db.payslips.findFirst({ where: { user_id: USERS.sato.id }, include: { items: true } });
    expect(slip).toMatchObject({ title: '立替金精算', status: 'planned', pay_month: month() });
    expect(slip!.items).toHaveLength(1);
  });

  test('合算: 支払予定の「給与」があれば優先し、賞与があってもそちらには入れない', async ({ as }) => {
    const bonus = await makePayslip({ title: '賞与' });
    const salary = await makePayslip({ title: '給与' });
    const c = await makeClaim({ status: 'approved', amount: 1000 });
    await reimburse(await as('admin'), { ids: [c.id], mode: 'payslip', pay_month: month() });
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.payslip_id).toBe(salary.id);
    expect(await db.payslip_items.count({ where: { payslip_id: bonus.id, system_key: { not: null } } })).toBe(0);
  });

  test('合算: 支払済の明細には入れず、新しい明細を作る', async ({ as }) => {
    const paid = await makePayslip({ status: 'paid' });
    const c = await makeClaim({ status: 'approved' });
    await reimburse(await as('admin'), { ids: [c.id], mode: 'payslip', pay_month: month() });
    const claim = await db.expense_claims.findUnique({ where: { id: c.id } });
    expect(claim!.payslip_id).not.toBe(paid.id);
    expect(await db.payslips.count({ where: { user_id: USERS.sato.id } })).toBe(2);
  });

  test('合算: 人ごとに別々の明細へ入る', async ({ as }) => {
    const a = await makeClaim({ role: 'sato', status: 'approved', amount: 1000 });
    const b = await makeClaim({ role: 'tanaka', status: 'approved', amount: 2000 });
    await reimburse(await as('admin'), { ids: [a.id, b.id], mode: 'payslip', pay_month: month() });
    const [pa, pb] = await Promise.all([a, b].map(x => db.expense_claims.findUnique({ where: { id: x.id } })));
    expect(pa!.payslip_id).not.toBe(pb!.payslip_id);
    expect((await db.payslips.findUnique({ where: { id: pb!.payslip_id! } }))!.user_id).toBe(USERS.tanaka.id);
  });

  test('合算済みの申請は、もう一度合算も別途返金もできない', async ({ as }) => {
    const c = await makeClaim({ status: 'approved' });
    const admin = await as('admin');
    await reimburse(admin, { ids: [c.id], mode: 'payslip', pay_month: month() });
    expect((await (await reimburse(admin, { ids: [c.id], mode: 'payslip', pay_month: month() })).json()).attached).toBe(0);
    expect((await (await reimburse(admin, { ids: [c.id] })).json()).reimbursed).toBe(0);
  });

  test('明細を支払済にすると、合算された申請が自動で返金済になる（返金日は支払日）', async ({ as }) => {
    const c = await makeClaim({ status: 'approved', amount: 3000 });
    const admin = await as('admin');
    await reimburse(admin, { ids: [c.id], mode: 'payslip', pay_month: month() });
    const slip = (await db.expense_claims.findUnique({ where: { id: c.id }, include: { payslip: true } }))!.payslip!;
    const put = await admin.put(`/api/work/payslips/${slip.id}`, { data: { pay_month: month(), title: slip.title, status: 'paid', pay_date: '2026-10-25', items: [] } });
    expect(put.status()).toBe(200);
    const row = await db.expense_claims.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ status: 'paid', reimbursed_by_id: USERS.admin.id, reimburse_note: '給与明細に合算して支払い' });
    expect(row!.reimbursed_at!.toISOString().slice(0, 10)).toBe('2026-10-25');
  });

  test('支払済の明細を保存し直しても、返金済は二重処理されない', async ({ as }) => {
    const c = await makeClaim({ status: 'approved', amount: 3000 });
    const admin = await as('admin');
    await reimburse(admin, { ids: [c.id], mode: 'payslip', pay_month: month() });
    const slip = (await db.expense_claims.findUnique({ where: { id: c.id }, include: { payslip: true } }))!.payslip!;
    const body = { pay_month: month(), title: slip.title, status: 'paid', pay_date: '2026-10-25', items: [] };
    await admin.put(`/api/work/payslips/${slip.id}`, { data: body });
    const first = (await db.expense_claims.findUnique({ where: { id: c.id } }))!.updated_at;
    await admin.put(`/api/work/payslips/${slip.id}`, { data: body });
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.updated_at).toEqual(first);
  });

  test('明細の編集では「立替金精算」の行が保たれ、金額は申請の合計になる', async ({ as }) => {
    const slip = await makePayslip({ items: [{ kind: 'earning', label: '基本給', amount: 300000 }] });
    const a = await makeClaim({ status: 'approved', amount: 1000 });
    const b = await makeClaim({ status: 'approved', amount: 2500 });
    const admin = await as('admin');
    await reimburse(admin, { ids: [a.id, b.id], mode: 'payslip', pay_month: month() });
    // the client sends only its own items; the system line must be rebuilt, not lost or duplicated
    await admin.put(`/api/work/payslips/${slip.id}`, { data: { pay_month: month(), title: '給与', status: 'planned', items: [{ kind: 'earning', label: '基本給', amount: 310000 }] } });
    const items = await db.payslip_items.findMany({ where: { payslip_id: slip.id } });
    expect(items.filter(i => i.system_key)).toHaveLength(1);
    expect(items.find(i => i.system_key)!.amount).toBe(3500);
    expect(items.find(i => !i.system_key)!.amount).toBe(310000);
  });

  test('明細の項目をすべて消しても、立替金が合算されていれば保存できる。合算がなければ400', async ({ as }) => {
    const admin = await as('admin');
    const plain = await makePayslip({});
    expect((await admin.put(`/api/work/payslips/${plain.id}`, { data: { pay_month: month(), title: '給与', status: 'planned', items: [] } })).status()).toBe(400);
    const c = await makeClaim({ status: 'approved' });
    await reimburse(admin, { ids: [c.id], mode: 'payslip', pay_month: month() });
    const slip = (await db.expense_claims.findUnique({ where: { id: c.id }, include: { payslip: true } }))!.payslip!;
    expect((await admin.put(`/api/work/payslips/${slip.id}`, { data: { pay_month: month(), title: slip.title, status: 'planned', items: [] } })).status()).toBe(200);
  });

  test('給与明細から外すと返金待ちに戻り、明細の行が再計算される', async ({ as }) => {
    const slip = await makePayslip({});
    const a = await makeClaim({ status: 'approved', amount: 1000 });
    const b = await makeClaim({ status: 'approved', amount: 2000 });
    const admin = await as('admin');
    await reimburse(admin, { ids: [a.id, b.id], mode: 'payslip', pay_month: month() });
    const un = await admin.post('/api/expenses/unlink', { data: { ids: [a.id] } });
    expect(await un.json()).toEqual({ detached: 1, skipped: 0 });
    expect((await db.expense_claims.findUnique({ where: { id: a.id } }))!.payslip_id).toBeNull();
    expect((await db.payslip_items.findFirst({ where: { payslip_id: slip.id, system_key: { not: null } } }))!.amount).toBe(2000);
    await admin.post('/api/expenses/unlink', { data: { ids: [b.id] } });
    expect(await db.payslip_items.count({ where: { payslip_id: slip.id, system_key: { not: null } } })).toBe(0);
  });

  test('支払済の明細からは外せない（スキップ）。管理者以外も不可', async ({ as }) => {
    const c = await makeClaim({ status: 'approved' });
    const admin = await as('admin');
    await reimburse(admin, { ids: [c.id], mode: 'payslip', pay_month: month() });
    expect((await (await as('sato')).post('/api/expenses/unlink', { data: { ids: [c.id] } })).status()).toBe(403);
    const slipId = (await db.expense_claims.findUnique({ where: { id: c.id } }))!.payslip_id!;
    await db.payslips.update({ where: { id: slipId }, data: { status: 'paid' } });
    expect(await (await admin.post('/api/expenses/unlink', { data: { ids: [c.id] } })).json()).toEqual({ detached: 0, skipped: 1 });
  });

  test('合算した明細を削除すると、申請は返金待ちに戻る', async ({ as }) => {
    const c = await makeClaim({ status: 'approved' });
    const admin = await as('admin');
    await reimburse(admin, { ids: [c.id], mode: 'payslip', pay_month: month() });
    const slipId = (await db.expense_claims.findUnique({ where: { id: c.id } }))!.payslip_id!;
    expect((await admin.delete(`/api/work/payslips/${slipId}`)).status()).toBe(200);
    expect(await db.expense_claims.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'approved', payslip_id: null });
  });

  test('本人の給与明細には「立替金精算」の内訳が出る', async ({ as }) => {
    const c = await makeClaim({ status: 'approved', amount: 7777, title: '精算される経費' });
    await reimburse(await as('admin'), { ids: [c.id], mode: 'payslip', pay_month: month() });
    const mine = (await (await (await as('sato')).get('/api/work/payslips?mine=1')).json()).items[0];
    expect(mine.items.find((i: { system: boolean }) => i.system)).toMatchObject({ amount: 7777, label: '立替金精算（1件）' });
    expect(mine.claims[0]).toMatchObject({ title: '精算される経費', amount: 7777 });
    expect(mine.net).toBe(7777);
  });
});

test.describe('出張との紐付け', () => {
  const base = (o: object = {}) => ({ expense_date: today(), category: '交通費', title: '新幹線代', amount: 12000, payment_method: 'personal', ...o });

  test('自分の承認済みの出張には紐付けられる', async ({ as }) => {
    const trip = await makeTrip({ role: 'sato', status: 'approved' });
    const res = await postClaim(await as('sato'), { title: '新幹線', trip_id: trip.id });
    expect(res.status()).toBe(201);
    expect((await db.expense_claims.findFirst({ where: { title: '新幹線' } }))!.trip_id).toBe(trip.id);
  });

  for (const [label, status, owner] of [
    ['承認待ちの出張', 'pending', 'sato'],
    ['却下された出張', 'rejected', 'sato'],
    ['取消済みの出張', 'cancelled', 'sato'],
    ['他人の承認済みの出張', 'approved', 'tanaka'],
  ] as const) {
    test(`${label}には紐付けられない（400）`, async ({ as }) => {
      const trip = await makeTrip({ role: owner, status });
      expect((await postClaim(await as('sato'), { trip_id: trip.id })).status()).toBe(400);
      expect(await db.expense_claims.count()).toBe(0);
    });
  }

  test('存在しない出張は400', async ({ as }) => {
    expect((await postClaim(await as('sato'), { trip_id: 'nope' })).status()).toBe(400);
  });

  test('編集で紐付け・解除ができ、送らなければ変わらない', async ({ as }) => {
    const trip = await makeTrip({ role: 'sato', status: 'approved' });
    const c = await makeClaim({ role: 'sato' });
    const sato = await as('sato');
    expect((await sato.patch(`/api/expenses/${c.id}`, { data: base({ trip_id: trip.id }) })).status()).toBe(200);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.trip_id).toBe(trip.id);
    expect((await sato.patch(`/api/expenses/${c.id}`, { data: base() })).status()).toBe(200);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.trip_id).toBe(trip.id);
    expect((await sato.patch(`/api/expenses/${c.id}`, { data: base({ trip_id: null }) })).status()).toBe(200);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.trip_id).toBeNull();
  });

  test('出張を取り消しても、紐付いた経費は残る', async ({ as }) => {
    const trip = await makeTrip({ role: 'sato', status: 'approved' });
    const c = await makeClaim({ role: 'sato', tripId: trip.id });
    expect((await (await as('sato')).post(`/api/trips/${trip.id}/cancel`)).status()).toBe(200);
    expect((await db.expense_claims.findUnique({ where: { id: c.id } }))!.trip_id).toBe(trip.id);
  });

  test('画面: 出張の詳細から経費を申請すると、その出張が選択済みで開く', async ({ browser }) => {
    const trip = await makeTrip({ role: 'sato', status: 'approved', destination: '大阪（B社）' });
    const ctx = await browser.newContext({ storageState: AUTH.sato, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();
    await page.goto(`/expenses?trip=${trip.id}`);
    await expect(page.getByText('出張に紐付ける（任意）')).toBeVisible();
    await expect(field(page, '出張に紐付ける')).toHaveValue(trip.id);
    await ctx.close();
  });
});
