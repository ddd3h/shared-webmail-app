import { test, expect } from './fixtures';
import { AUTH } from './helpers/constants';
import { db } from './helpers/db';
import { jstDate, resetTransfers } from './helpers/seed';
import { makePayment, makeVendor } from './helpers/factories';
import { transferSlotFor } from '../src/lib/transfer-days';

// 振込申請は、期日に間に合う15日か25日の振込に自動で振り分けられる（月2回）。
test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => { await resetTransfers(); });
test.afterAll(async () => { await resetTransfers(); });

const monthOf = (date: string) => date.slice(0, 7);
const slotFor = (due: string) => transferSlotFor(due, jstDate(0));

test.describe('API', () => {
  test('申請の一覧に、振込予定日（15日か25日）と、期日に遅れるかどうかが付く', async ({ as }) => {
    const v = await makeVendor({});
    const due = jstDate(40);
    await makePayment({ role: 'sato', vendorId: v.id, status: 'approved', due });
    const items = (await (await (await as('sato')).get('/api/payments?scope=mine')).json()).items;
    const slot = slotFor(due);
    expect(items[0]).toMatchObject({ due_date: due, transfer_date: slot.date, transfer_day: slot.day, transfer_late: false });
    expect(slot.date <= due).toBe(true);
    expect([15, 25]).toContain(slot.day);
  });

  test('期日がもう過ぎている申請は、次の振込日になり、期日に遅れる印が付く。振込済みのものには付かない', async ({ as }) => {
    const v = await makeVendor({});
    await makePayment({ role: 'sato', vendorId: v.id, status: 'approved', due: jstDate(-3), title: '過ぎた期日' });
    await makePayment({ role: 'sato', vendorId: v.id, status: 'paid', due: jstDate(-3), title: '払い済み' });
    const items = (await (await (await as('sato')).get('/api/payments?scope=mine')).json()).items;
    const late = items.find((i: { title: string }) => i.title === '過ぎた期日');
    expect(late.transfer_late).toBe(true);
    expect(late.transfer_date >= jstDate(0)).toBe(true);
    expect(items.find((i: { title: string }) => i.title === '払い済み')).toMatchObject({ transfer_date: null, transfer_day: null, transfer_late: false });
  });

  test('月次まとめでは、振込申請が割り当てられた振込日（15日／25日）で並び、絞り込める情報（slot）が付く', async ({ as }) => {
    const v = await makeVendor({});
    const due = jstDate(5);
    const p = await makePayment({ role: 'sato', vendorId: v.id, status: 'approved', due });
    const slot = slotFor(due);
    const d = await (await (await as('keiri')).get(`/api/transfers/monthly?month=${monthOf(slot.date)}`)).json();
    const row = d.items.find((i: { key: string }) => i.key === `payment:${p.id}`);
    expect(row).toMatchObject({ kind_label: '振込申請', scheduled_date: slot.date, slot: slot.day, overdue: slot.late });
  });

  test('期日が来月でも、今月の振込日に間に合うなら今月の一覧に入り、来月の振込日になるものは入らない', async ({ as }) => {
    const v = await makeVendor({});
    const today = jstDate(0);
    const nextMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const far = new Date(nextMonth); far.setUTCDate(28);
    const farDue = far.toISOString().slice(0, 10);
    const p = await makePayment({ role: 'sato', vendorId: v.id, status: 'approved', due: farDue });
    const slot = slotFor(farDue);
    const here = (await (await (await as('keiri')).get(`/api/transfers/monthly?month=${today.slice(0, 7)}`)).json()).items.map((i: { key: string }) => i.key);
    expect(here.includes(`payment:${p.id}`)).toBe(monthOf(slot.date) <= today.slice(0, 7));
    const there = (await (await (await as('keiri')).get(`/api/transfers/monthly?month=${monthOf(slot.date)}`)).json()).items.map((i: { key: string }) => i.key);
    expect(there).toContain(`payment:${p.id}`);
  });
});

test.describe('画面', () => {
  test.describe('申請者', () => {
    test.use({ storageState: AUTH.sato });
    test('支払期日を入れると、振り込まれる日（15日か25日）がその場で出る', async ({ page }) => {
      await makeVendor({ name: '振込日テスト商事' });
      await page.goto('/payments');
      await page.getByRole('button', { name: '＋ 振込を申請' }).click();
      const due = jstDate(40);
      await page.getByText('支払期日', { exact: true }).locator('xpath=following-sibling::input').fill(due);
      const slot = slotFor(due);
      await expect(page.getByTestId('transfer-slot-preview')).toContainText(`${Number(slot.date.slice(5, 7))}/${Number(slot.date.slice(8))}`);
      await expect(page.getByTestId('transfer-slot-preview')).toContainText(`${slot.day}日振込`);
    });
    test('期日が過ぎていると、間に合わないと出る', async ({ page }) => {
      await page.goto('/payments');
      await page.getByRole('button', { name: '＋ 振込を申請' }).click();
      await page.getByText('支払期日', { exact: true }).locator('xpath=following-sibling::input').fill(jstDate(-3));
      await expect(page.getByTestId('transfer-slot-preview')).toContainText('間に合いません');
    });
    test('申請の一覧にも「◯日振込」が出る', async ({ page }) => {
      const v = await makeVendor({});
      const due = jstDate(40);
      await makePayment({ role: 'sato', vendorId: v.id, status: 'approved', due, title: '一覧に出る' });
      await page.goto('/payments');
      await expect(page.getByRole('button', { name: /一覧に出る/ }).getByTestId('transfer-slot')).toContainText(`${slotFor(due).day}日振込`);
    });
  });

  test.describe('経理', () => {
    test.use({ storageState: AUTH.keiri });
    test('月次まとめで「15日振込」「25日振込」に絞り込める', async ({ page }) => {
      const v = await makeVendor({});
      const due = jstDate(3);
      await makePayment({ role: 'sato', vendorId: v.id, status: 'approved', due, title: '絞り込みの分' });
      const slot = slotFor(due);
      await page.goto('/transfers');
      // the transfer day may fall in next month (when today is late in the month): step to that month
      if (monthOf(slot.date) > jstDate(0).slice(0, 7)) await page.getByRole('button', { name: '次の月' }).click();
      const group = page.getByRole('group', { name: '振込日で絞り込む' });
      await expect(group).toBeVisible();
      await expect(page.getByText('絞り込みの分')).toBeVisible();
      await expect(page.getByText(`${slot.day}日振込）`).first()).toBeVisible();
      await group.getByRole('button', { name: slot.day === 15 ? '25日振込' : '15日振込' }).click();
      await expect(page.getByText('絞り込みの分')).toHaveCount(0);
      await group.getByRole('button', { name: `${slot.day}日振込` }).click();
      await expect(page.getByText('絞り込みの分')).toBeVisible();
      await group.getByRole('button', { name: 'すべて' }).click();
      await expect(page.getByText('絞り込みの分')).toBeVisible();
    });
  });
});
