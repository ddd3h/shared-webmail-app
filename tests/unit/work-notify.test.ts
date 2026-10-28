import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    users: { findMany: vi.fn(), findUnique: vi.fn() },
    expense_claims: { findUnique: vi.fn(), findMany: vi.fn() },
    work_reports: { findUnique: vi.fn() },
    payslips: { findUnique: vi.fn() },
  },
}));
const send = vi.fn();
const approvers = vi.fn(async (_userId: string): Promise<{ id: string; email: string }[]> => []);
vi.mock('@/lib/org-server', () => ({ approversOf: (id: string) => approvers(id) }));
vi.mock('@/lib/mattermost-dm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mattermost-dm')>('@/lib/mattermost-dm');
  return { mmText: actual.mmText, sendDirectMessage: (...a: any[]) => send(...a) };
});

import { prisma } from '@/lib/db';
import {
  notifyAttendanceEdited, notifyExpenseReimbursed, notifyExpenseReviewed, notifyExpenseSubmitted, notifyPayslip, notifyWorkReportSubmitted,
} from '@/lib/work-notify';

const claim = (o: object = {}) => ({
  id: 'c1', user_id: 'u2', amount: 12345, category: '交通費', title: '新幹線代', payment_method: 'personal',
  review_comment: null, user: { id: 'u2', name: '佐藤', email: 'sato@example.com' }, ...o,
});

beforeEach(() => { vi.resetAllMocks(); send.mockResolvedValue(true); approvers.mockResolvedValue([]); });

describe('経費申請の通知', () => {
  it('申請者以外の管理者全員に届く', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim());
    (prisma.users.findMany as any).mockResolvedValue([{ id: 'a1', email: 'a1@example.com' }, { id: 'a2', email: 'a2@example.com' }]);
    await notifyExpenseSubmitted('c1');
    expect((prisma.users.findMany as any).mock.calls[0][0].where).toEqual({ role: 'admin', id: { not: 'u2' } });
    expect(send).toHaveBeenCalledTimes(2);
    const msg = send.mock.calls[0][2] as string;
    expect(msg).toContain('¥12,345');
    expect(msg).toContain('/approvals');
    expect(msg).toContain('立替');
  });
  it('申請者の部署長（承認できる人）にも届く。管理者と重なっても1通だけ', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim());
    (prisma.users.findMany as any).mockResolvedValue([{ id: 'a1', email: 'a1@example.com' }]);
    approvers.mockResolvedValue([{ id: 'a1', email: 'a1@example.com' }, { id: 'h1', email: 'h1@example.com' }]);
    await notifyExpenseSubmitted('c1');
    expect(approvers).toHaveBeenCalledWith('u2');
    expect(send.mock.calls.map(c => c[0]).sort()).toEqual(['a1', 'h1']);
    expect(send.mock.calls[0][2]).toContain('/approvals');
  });
  it('再申請と分かる文言になる', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim());
    (prisma.users.findMany as any).mockResolvedValue([{ id: 'a1', email: 'a1@example.com' }]);
    await notifyExpenseSubmitted('c1', true);
    expect(send.mock.calls[0][2]).toContain('再申請');
  });
  it('件名の@メンションやリンクは無効化される', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ title: '@channel [click](http://evil)' }));
    (prisma.users.findMany as any).mockResolvedValue([{ id: 'a1', email: 'a1@example.com' }]);
    await notifyExpenseSubmitted('c1');
    const msg = send.mock.calls[0][2] as string;
    expect(msg).not.toContain('@channel');
    expect(msg).not.toContain('](http://evil)');
  });
  it('送信が失敗しても例外を投げない', async () => {
    (prisma.expense_claims.findUnique as any).mockRejectedValue(new Error('db down'));
    await expect(notifyExpenseSubmitted('c1')).resolves.toBeUndefined();
  });
});

describe('承認・却下の通知', () => {
  it('承認(立替)は申請者本人に返金待ちと伝える', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim());
    await notifyExpenseReviewed('c1', 'approve');
    expect(send.mock.calls[0].slice(0, 2)).toEqual(['u2', 'sato@example.com']);
    expect(send.mock.calls[0][2]).toContain('承認されました');
    expect(send.mock.calls[0][2]).toContain('返金');
  });
  it('承認(会社負担)は返金に触れない', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ payment_method: 'company' }));
    await notifyExpenseReviewed('c1', 'approve');
    expect(send.mock.calls[0][2]).toContain('会社負担');
  });
  it('却下は理由を含む', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ review_comment: '宛名が違います' }));
    await notifyExpenseReviewed('c1', 'reject');
    expect(send.mock.calls[0][2]).toContain('却下');
    expect(send.mock.calls[0][2]).toContain('宛名が違います');
  });
});

describe('返金の通知', () => {
  it('人ごとに1通、件数と合計を伝える', async () => {
    (prisma.expense_claims.findMany as any).mockResolvedValue([
      { amount: 1000, user: { id: 'u2', email: 'sato@example.com' } },
      { amount: 2500, user: { id: 'u2', email: 'sato@example.com' } },
      { amount: 700, user: { id: 'u3', email: 'suzuki@example.com' } },
    ]);
    await notifyExpenseReimbursed(['a', 'b', 'c'], '2026-10-25', '給与と合算');
    expect(send).toHaveBeenCalledTimes(2);
    const sato = send.mock.calls.find(c => c[0] === 'u2')![2] as string;
    expect(sato).toContain('2件');
    expect(sato).toContain('¥3,500');
    expect(sato).toContain('2026-10-25');
    expect(sato).toContain('給与と合算');
  });
});

describe('業務報告書・給与明細・勤怠の通知', () => {
  it('業務報告書は提出者以外の管理者に届く', async () => {
    (prisma.work_reports.findUnique as any).mockResolvedValue({ user_id: 'u3', title: '10月第3週', hours: 32.5, user: { id: 'u3', name: '鈴木' } });
    (prisma.users.findMany as any).mockResolvedValue([{ id: 'a1', email: 'a1@example.com' }]);
    await notifyWorkReportSubmitted('r1');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toContain('32.5h');
  });
  it('給与明細の通知に金額は含めない', async () => {
    (prisma.payslips.findUnique as any).mockResolvedValue({ pay_month: '2026-10', title: '給与', status: 'planned', user: { id: 'u2', email: 'sato@example.com' } });
    await notifyPayslip('p1', 'created');
    const msg = send.mock.calls[0][2] as string;
    expect(msg).toContain('2026年10月分');
    expect(msg).not.toMatch(/[¥￥]|\d{4,}円/);
    await notifyPayslip('p1', 'paid');
    expect(send.mock.calls[1][2]).toContain('支払済になりました');
  });
  it('勤怠の修正は本人に届く', async () => {
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'u2', email: 'sato@example.com' });
    await notifyAttendanceEdited('u2', '2026-10-08');
    expect(send.mock.calls[0][0]).toBe('u2');
    expect(send.mock.calls[0][2]).toContain('2026-10-08');
  });
});
