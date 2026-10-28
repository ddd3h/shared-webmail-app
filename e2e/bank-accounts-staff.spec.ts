import { test, expect } from './fixtures';
import { AUTH, USERS } from './helpers/constants';
import { db } from './helpers/db';
import { resetTransfers } from './helpers/seed';
import { verifyBankAccount } from './helpers/factories';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetTransfers(); });
test.afterAll(async () => { await resetTransfers(); });

const ACCOUNT = { bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '新宿支店', branch_code: '234', account_type: 'ordinary', account_number: '1234567', account_holder: 'サトウ タロウ' };
const row = (userId: string) => db.user_bank_accounts.findUnique({ where: { user_id: userId } });

test.describe('管理者・経理が、全員の口座を登録・変更・削除できる', () => {
  test('経理も管理者も、口座のない人に登録できる。確認済にはならず、変更した人が記録される', async ({ as }) => {
    for (const [who, id] of [['keiri', USERS.keiri.id], ['admin', USERS.admin.id]] as const) {
      await resetTransfers();
      const res = await (await as(who)).put(`/api/bank-accounts/${USERS.sato.id}`, { data: ACCOUNT });
      expect(res.status(), who).toBe(200);
      expect((await res.json()).account).toMatchObject({ bank_code: '0001', account_number: '1234567', verified: false });
      expect(await row(USERS.sato.id)).toMatchObject({ verified_at: null, changed_by_id: id });
    }
  });

  test('確認済の口座を変えると確認済が外れる。同じ内容なら外れない', async ({ as }) => {
    await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
    expect((await verifyBankAccount(await as('keiri'), USERS.sato.id)).status()).toBe(200);
    const admin = await as('admin');
    expect((await admin.put(`/api/bank-accounts/${USERS.sato.id}`, { data: ACCOUNT })).status()).toBe(200);
    expect((await row(USERS.sato.id))!.verified_at).not.toBeNull();
    const res = await admin.put(`/api/bank-accounts/${USERS.sato.id}`, { data: { ...ACCOUNT, account_number: '7654321' } });
    expect((await res.json()).verification_cleared).toBe(true);
    expect((await row(USERS.sato.id))!.verified_at).toBeNull();
  });

  test('変更した人は、その口座を確認済にできない。別の経理・管理者ならできる', async ({ as }) => {
    const keiri = await as('keiri');
    await keiri.put(`/api/bank-accounts/${USERS.sato.id}`, { data: ACCOUNT });
    const mine = await verifyBankAccount(keiri, USERS.sato.id);
    expect(mine.status()).toBe(403);
    expect((await mine.json()).error).toBe('self_verify_change');
    expect((await verifyBankAccount(await as('admin'), USERS.sato.id)).status()).toBe(200);
  });

  test('本人が直すと、変更者の記録は本人に戻る', async ({ as }) => {
    await (await as('keiri')).put(`/api/bank-accounts/${USERS.sato.id}`, { data: ACCOUNT });
    await (await as('sato')).put('/api/bank-accounts/me', { data: { ...ACCOUNT, account_number: '7654321' } });
    expect((await row(USERS.sato.id))!.changed_by_id).toBeNull();
  });

  test('削除できる。もう一度削除すると404', async ({ as }) => {
    await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
    const keiri = await as('keiri');
    expect((await keiri.delete(`/api/bank-accounts/${USERS.sato.id}`)).status()).toBe(200);
    expect(await row(USERS.sato.id)).toBeNull();
    expect((await keiri.delete(`/api/bank-accounts/${USERS.sato.id}`)).status()).toBe(404);
  });

  test('入力が正しくなければ400。存在しない人は404', async ({ as }) => {
    const keiri = await as('keiri');
    const bad = await keiri.put(`/api/bank-accounts/${USERS.sato.id}`, { data: { ...ACCOUNT, bank_code: '001' } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).fields).toContain('bank_code');
    expect((await keiri.put('/api/bank-accounts/u_nobody', { data: ACCOUNT })).status()).toBe(404);
    expect(await db.user_bank_accounts.count()).toBe(0);
  });

  test('一般ユーザー・業務委託・未ログインは、他の人の口座を変えられない', async ({ as, anon }) => {
    await (await as('sato')).put('/api/bank-accounts/me', { data: ACCOUNT });
    for (const who of ['tanaka', 'suzuki', 'sato'] as const) {
      const c = await as(who);
      expect((await c.put(`/api/bank-accounts/${USERS.sato.id}`, { data: { ...ACCOUNT, account_number: '7654321' } })).status(), who).toBe(403);
      expect((await c.delete(`/api/bank-accounts/${USERS.sato.id}`)).status(), who).toBe(403);
    }
    expect((await anon.put(`/api/bank-accounts/${USERS.sato.id}`, { data: ACCOUNT, maxRedirects: 0 })).status()).not.toBe(200);
    expect((await row(USERS.sato.id))!.account_last4).toBe('4567');
  });

  test('監査ログには、誰が誰の口座をどう変えたか（下4桁だけ）を残す', async ({ as }) => {
    const keiri = await as('keiri');
    await keiri.put(`/api/bank-accounts/${USERS.sato.id}`, { data: ACCOUNT });
    await keiri.delete(`/api/bank-accounts/${USERS.sato.id}`);
    const change = await db.audit_logs.findFirstOrThrow({ where: { action_type: 'bank_account_change', actor_user_id: USERS.keiri.id } });
    expect(JSON.parse(change.metadata_json)).toMatchObject({ user_id: USERS.sato.id, by_staff: true, new_last4: '4567' });
    expect(change.metadata_json).not.toContain('1234567');
    const del = await db.audit_logs.findFirstOrThrow({ where: { action_type: 'bank_account_delete', actor_user_id: USERS.keiri.id } });
    expect(JSON.parse(del.metadata_json)).toMatchObject({ user_id: USERS.sato.id, last4: '4567' });
  });

  test('画面: 振込データ › 口座で、経理が登録・編集・削除できる', async ({ browser }) => {
    await db.user_bank_accounts.create({ data: { user_id: USERS.tanaka.id, bank_name: '旧銀行', bank_code: '0009', branch_name: '旧支店', branch_code: '001', account_type: 'ordinary', account_number_enc: 'x', account_last4: '0000', account_holder: 'タナカ' } });
    const ctx = await browser.newContext({ storageState: AUTH.keiri, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto('/transfers');
    await page.getByRole('button', { name: '受取口座の確認', exact: true }).click();
    await page.getByRole('button', { name: '佐藤の口座を登録' }).click();
    const dlg = page.getByRole('dialog', { name: '佐藤さんの口座' });
    await dlg.getByLabel('銀行名').fill('みずほ銀行');
    await dlg.getByLabel('銀行コード').fill('0001');
    await dlg.getByLabel('支店名').fill('新宿支店');
    await dlg.getByLabel('支店コード').fill('234');
    await dlg.getByLabel('口座番号').fill('1234567');
    await dlg.getByLabel('口座名義（カナ）').fill('サトウ タロウ');
    await dlg.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('佐藤さんの口座を保存しました')).toBeVisible();
    expect(await row(USERS.sato.id)).toMatchObject({ bank_code: '0001', changed_by_id: USERS.keiri.id });

    await page.getByRole('button', { name: '佐藤の口座を編集' }).click();
    await page.getByRole('dialog', { name: '佐藤さんの口座' }).getByLabel('口座番号').fill('12');
    await page.getByRole('dialog', { name: '佐藤さんの口座' }).getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('口座番号は4〜7桁');
    await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();

    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '田中の口座を削除' }).click();
    await expect(page.getByText('田中さんの口座を削除しました')).toBeVisible();
    expect(await row(USERS.tanaka.id)).toBeNull();
    // the one who changed it cannot confirm it
    await page.getByRole('button', { name: '確認済にする' }).first().click();
    await expect(page.getByText('自分が変更した口座は、他の経理担当・管理者が確認してください')).toBeVisible();
    await ctx.close();
  });
});
