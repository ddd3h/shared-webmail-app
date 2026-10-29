import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    transfer_batches: { findUnique: vi.fn() },
    payslips: { findMany: vi.fn() },
    expense_claims: { findMany: vi.fn() },
    payment_requests: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/org-server', () => ({ approversOf: vi.fn(async () => []) }));
vi.mock('@/lib/mattermost-dm', async () => ({ ...(await vi.importActual<object>('@/lib/mattermost-dm')), sendDirectMessage: vi.fn(async () => true) }));

import { notifyBatchConfirmed } from '@/lib/work-notify';
import { prisma } from '@/lib/db';
import { sendDirectMessage } from '@/lib/mattermost-dm';

const db = prisma as any;
const u = (id: string) => ({ id, email: `${id}@example.com` });

beforeEach(() => {
  vi.clearAllMocks();
  db.transfer_batches.findUnique.mockResolvedValue({ transfer_date: new Date('2026-11-25T00:00:00Z') });
  db.payslips.findMany.mockResolvedValue([]);
  db.expense_claims.findMany.mockResolvedValue([]);
  db.payment_requests.findMany.mockResolvedValue([]);
});

describe('振込の確定の通知', () => {
  it('振り込まれる人ごとに1通。給与と経費が同じ人なら、まとめて1通', async () => {
    db.payslips.findMany.mockResolvedValue([{ pay_month: '2026-10', title: '役員報酬', user: u('e1') }, { pay_month: '2026-10', title: '給与', user: u('s1') }]);
    db.expense_claims.findMany.mockResolvedValue([{ user: u('e1') }, { user: u('e1') }]);
    await notifyBatchConfirmed('b1');
    const calls = (sendDirectMessage as any).mock.calls;
    expect(calls).toHaveLength(2);
    const [, , text, type] = calls.find((c: any[]) => c[0] === 'e1');
    expect(type).toBe('payment_confirmed');
    expect(text).toContain('お振込が確定しました');
    expect(text).toContain('振込予定日: 11/25');
    expect(text).toContain('2026-10分 役員報酬');
    expect(text).toContain('経費の立替金（2件）');
  });

  it('金額と口座は載せない', async () => {
    db.payslips.findMany.mockResolvedValue([{ pay_month: '2026-10', title: '給与', user: u('s1'), items: [{ amount: 255000 }] }]);
    await notifyBatchConfirmed('b1');
    const text = (sendDirectMessage as any).mock.calls[0][2] as string;
    expect(text).not.toMatch(/¥|円|255000|\*{4}/);
  });

  it('振込申請は、申請した人に知らせる（取引先には送らない）', async () => {
    db.payment_requests.findMany.mockResolvedValue([{ title: '10月分の外注費', user: u('app1'), vendor: { name: 'A社' } }]);
    await notifyBatchConfirmed('b1');
    const [userId, , text] = (sendDirectMessage as any).mock.calls[0];
    expect(userId).toBe('app1');
    expect(text).toContain('振込申請「10月分の外注費」（A社 宛）');
  });

  it('ファイルが見つからなければ、何も送らない。送信で例外が出ても呼び出し元には投げない', async () => {
    db.transfer_batches.findUnique.mockResolvedValue(null);
    await notifyBatchConfirmed('nope');
    expect(sendDirectMessage).not.toHaveBeenCalled();
    db.transfer_batches.findUnique.mockResolvedValue({ transfer_date: new Date('2026-11-25T00:00:00Z') });
    db.payslips.findMany.mockResolvedValue([{ pay_month: '2026-10', title: '給与', user: u('s1') }]);
    (sendDirectMessage as any).mockRejectedValueOnce(new Error('mm down'));
    await expect(notifyBatchConfirmed('b1')).resolves.toBeUndefined();
  });

  it('DB由来の題名の記号は無害にする（Mattermost の @メンション等）', async () => {
    db.payslips.findMany.mockResolvedValue([{ pay_month: '2026-10', title: '@channel 給与', user: u('s1') }]);
    await notifyBatchConfirmed('b1');
    const text = (sendDirectMessage as any).mock.calls[0][2] as string;
    expect(text).not.toContain('@channel');
  });
});
