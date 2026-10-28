import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    payslips: { findMany: vi.fn() },
    payment_requests: { findMany: vi.fn() },
    expense_claims: { findMany: vi.fn() },
    work_reports: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/pay-schedule-server', async () => {
  const { DEFAULT_SCHEDULES } = await import('@/lib/pay-schedule');
  return { loadSchedules: vi.fn(async () => ({ schedules: DEFAULT_SCHEDULES, custom: new Set() })), planOf: vi.fn() };
});

import { loadMonthlyItems } from '@/lib/transfer-monthly';
import { prisma } from '@/lib/db';

const db = prisma as any;
const account = { verified_at: new Date(), account_last4: '1234', bank_name: 'み', branch_name: '新宿' };
// 10月分(末締め): 10/1〜10/31。振込日は、準業務委託=月末、役員=翌月25日
const slip = (id: string, userId: string, type: string, title: string, o: object = {}) => ({
  id, user_id: userId, pay_month: '2026-10', title, pay_date: new Date('2026-11-30T00:00:00Z'), batch_id: null, created_at: new Date(),
  items: [{ kind: 'earning', amount: 100000, label: title }], user: { id: userId, name: userId, worker_type: type, bank_account: account }, ...o,
});
const report = (userId: string, date: string, flag = false) => ({ user_id: userId, report_date: new Date(`${date}T00:00:00Z`), activity_flag: flag });
const by = (items: any[], who: string) => items.find(i => i.who === who);

beforeEach(() => {
  vi.clearAllMocks();
  db.payment_requests.findMany.mockResolvedValue([]);
  db.expense_claims.findMany.mockResolvedValue([]);
  db.work_reports.findMany.mockResolvedValue([]);
});

describe('月次まとめの印（報告書・活動警告）', () => {
  it('その期間の報告書がない準業務委託・業務委託の報酬には「報告書未提出」の印が付く（止めはしない）', async () => {
    db.payslips.findMany.mockResolvedValue([slip('s1', 'q1', 'quasi_contractor', '業務委託報酬'), slip('s2', 'c1', 'contractor', '報酬')]);
    const items = await loadMonthlyItems('2026-11');
    expect(by(items, 'q1')).toMatchObject({ report_missing: true, activity_flag: false, blocker: null });
    expect(by(items, 'c1')).toMatchObject({ report_missing: true });
  });

  it('期間の中(10/1〜10/31)の報告書が1件でもあれば、未提出ではない。期間の外の報告書は数えない', async () => {
    db.payslips.findMany.mockResolvedValue([slip('s1', 'q1', 'quasi_contractor', '業務委託報酬'), slip('s2', 'q2', 'quasi_contractor', '業務委託報酬')]);
    db.work_reports.findMany.mockResolvedValue([report('q1', '2026-10-31'), report('q2', '2026-11-01'), report('q2', '2026-09-30')]);
    const items = await loadMonthlyItems('2026-11');
    expect(by(items, 'q1').report_missing).toBe(false);
    expect(by(items, 'q2').report_missing).toBe(true);
  });

  it('期間の中に、警告つきで出された報告書があれば「活動警告」の印', async () => {
    db.payslips.findMany.mockResolvedValue([slip('s1', 'q1', 'quasi_contractor', '業務委託報酬')]);
    db.work_reports.findMany.mockResolvedValue([report('q1', '2026-10-05'), report('q1', '2026-10-20', true)]);
    expect(by(await loadMonthlyItems('2026-11'), 'q1')).toMatchObject({ report_missing: false, activity_flag: true });
  });

  it('他の人の報告書は数えない', async () => {
    db.payslips.findMany.mockResolvedValue([slip('s1', 'q1', 'quasi_contractor', '業務委託報酬')]);
    db.work_reports.findMany.mockResolvedValue([report('someone-else', '2026-10-05', true)]);
    expect(by(await loadMonthlyItems('2026-11'), 'q1')).toMatchObject({ report_missing: true, activity_flag: false });
  });

  it('役員・従業員、賞与、立替金精算の明細には、印を付けない', async () => {
    db.payslips.findMany.mockResolvedValue([
      slip('s1', 'e1', 'executive', '役員報酬'), slip('s2', 'm1', 'employee', '給与'),
      slip('s3', 'q3', 'quasi_contractor', '賞与（夏季）'), slip('s4', 'q4', 'quasi_contractor', '立替金精算'),
    ]);
    const items = await loadMonthlyItems('2026-11');
    for (const who of ['e1', 'm1', 'q3', 'q4']) expect(by(items, who), who).toMatchObject({ report_missing: false, activity_flag: false });
  });

  it('報告書を出す人の報酬がなければ、報告書の検索はしない', async () => {
    db.payslips.findMany.mockResolvedValue([slip('s1', 'e1', 'executive', '役員報酬')]);
    await loadMonthlyItems('2026-11');
    expect(db.work_reports.findMany).not.toHaveBeenCalled();
  });

  it('賞与は「賞与」「役員賞与」と呼ぶ（役員の賞与を役員報酬と呼ばない）', async () => {
    db.payslips.findMany.mockResolvedValue([slip('s1', 'e1', 'executive', '役員賞与', { pay_date: new Date('2026-11-25T00:00:00Z') }), slip('s2', 'm1', 'employee', '賞与', { pay_date: new Date('2026-11-25T00:00:00Z') }), slip('s3', 'e2', 'executive', '役員報酬', { pay_date: new Date('2026-11-25T00:00:00Z') })]);
    const items = await loadMonthlyItems('2026-11');
    expect([by(items, 'e1').kind_label, by(items, 'm1').kind_label, by(items, 'e2').kind_label]).toEqual(['役員賞与', '賞与', '役員報酬']);
  });
});
