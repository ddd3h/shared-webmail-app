import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} })); // mmText lives next to the DM sender, which imports the database

import { planNotices, type PlanInput, type ReportWorker } from '@/lib/autoflow/plan';
import { DEFAULT_CONFIG } from '@/lib/autoflow/config';
import { DEFAULT_SCHEDULES } from '@/lib/pay-schedule';

// 末日締め・提出期限は締め日の5日後（既定）。10月分: 締め日 10/31、提出期限 11/05
const on = (over: Partial<PlanInput['config']> = {}) => ({ ...DEFAULT_CONFIG, report: { enabled: true }, expense: { enabled: true, days_before: 3 }, payment: { enabled: true, days_before: 3 }, ...over });
const worker = (over: Partial<ReportWorker> = {}): ReportWorker => ({ id: 'w1', email: 'w1@example.com', name: '山田', worker_type: 'quasi_contractor', joined: '2026-01-01', report_dates: [], ...over });
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  today: '2026-10-30', config: on(), schedules: DEFAULT_SCHEDULES, appUrl: 'https://mail.example.com',
  reportWorkers: [worker()], expenseUsers: new Map(), claims: [], approversOf: new Map(), payItems: [], finance: [], ...over,
});

describe('オートフロー: 業務報告書', () => {
  it('締め日の前日に、まだ出していない人へ催促する', () => {
    const [n, ...rest] = planNotices(input({ today: '2026-10-30' }));
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({ rule: 'report', stage: 'eve', subject_key: 'report:2026-10', type: 'work_report_reminder', user: { id: 'w1' } });
    expect(n.text).toContain('10月分');
    expect(n.text).toContain('https://mail.example.com/work');
    expect(n.title).toBe('⏰ 業務報告書の締め日は明日です');
  });

  it('締め日当日は、報酬が支払われない旨を知らせる', () => {
    const [n] = planNotices(input({ today: '2026-10-31' }));
    expect(n).toMatchObject({ stage: 'closing' });
    expect(n.text).toContain('報酬は支払われません');
  });

  it('提出期限日にまだなら、再通知する', () => {
    const [n] = planNotices(input({ today: '2026-11-05' }));
    expect(n).toMatchObject({ stage: 'final', subject_key: 'report:2026-10' });
    expect(n.text).toContain('再通知');
  });

  it('それ以外の日は何も送らない', () => {
    for (const today of ['2026-10-29', '2026-11-01', '2026-11-04', '2026-11-06']) expect(planNotices(input({ today }))).toHaveLength(0);
  });

  it('その期間の報告書が1件でもあれば送らない。期間の外の日付なら数えない', () => {
    expect(planNotices(input({ reportWorkers: [worker({ report_dates: ['2026-10-15'] })] }))).toHaveLength(0);
    expect(planNotices(input({ reportWorkers: [worker({ report_dates: ['2026-09-30'] })] }))).toHaveLength(1);
  });

  it('締め日が月末でない人は、その人の期間で見る（15日締めなら 9/16〜10/15）', () => {
    const schedules = { ...DEFAULT_SCHEDULES, quasi_contractor: { ...DEFAULT_SCHEDULES.quasi_contractor, closing_day: 15 } };
    expect(planNotices(input({ schedules, today: '2026-10-14' }))).toHaveLength(1);
    expect(planNotices(input({ schedules, today: '2026-10-30' }))).toHaveLength(0);
    // 10/05 の報告書は 9/16〜10/15 の中なので出した扱い
    expect(planNotices(input({ schedules, today: '2026-10-14', reportWorkers: [worker({ report_dates: ['2026-10-05'] })] }))).toHaveLength(0);
  });

  it('報告書を出さない種類（正社員など）と、期間が終わってから入った人には送らない', () => {
    expect(planNotices(input({ reportWorkers: [worker({ worker_type: 'employee' })] }))).toHaveLength(0);
    expect(planNotices(input({ reportWorkers: [worker({ joined: '2026-11-01' })] }))).toHaveLength(0);
  });

  it('OFF なら送らない', () => {
    expect(planNotices(input({ config: on({ report: { enabled: false } }) }))).toHaveLength(0);
  });

  it('提出期限が0日（締め日と同じ日）のとき、同じ日に2通にならない', () => {
    const schedules = { ...DEFAULT_SCHEDULES, quasi_contractor: { ...DEFAULT_SCHEDULES.quasi_contractor, report_deadline_days: 0 } };
    expect(planNotices(input({ schedules, today: '2026-10-31' }))).toHaveLength(1);
  });
});

describe('オートフロー: 経費', () => {
  // 10月の経費の申請期限は 11/05
  const user = { id: 'u1', email: 'u1@example.com', name: '佐藤', worker_type: 'employee' as const };
  const claim = (over = {}) => ({ user_id: 'u1', title: 'タクシー代', amount: 1200, status: 'pending' as const, expense_date: '2026-10-10', submitted: '2026-10-10', ...over });
  const base = (over: Partial<PlanInput> = {}) => input({ reportWorkers: [], expenseUsers: new Map([['u1', user]]), config: on({ report: { enabled: false } }), ...over });

  it('申請期限の3日前に、承認待ちと差戻しの両方を本人へ知らせる', () => {
    const [n] = planNotices(base({ today: '2026-11-02', claims: [claim(), claim({ title: '会議費', status: 'rejected', amount: 800 })] }));
    expect(n).toMatchObject({ rule: 'expense', stage: 'before', subject_key: 'expense:2026-10', type: 'expense_reminder', user: { id: 'u1' } });
    expect(n.text).toContain('差戻し・却下');
    expect(n.text).toContain('承認待ち: 1件');
    expect(n.text).toContain('会議費');
    expect(n.text).toContain('¥1,200');
  });

  it('申請期限の当日にも知らせる。ほかの日は送らない', () => {
    expect(planNotices(base({ today: '2026-11-05', claims: [claim()] }))[0]).toMatchObject({ stage: 'on' });
    for (const today of ['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-06']) expect(planNotices(base({ today, claims: [claim()] }))).toHaveLength(0);
  });

  it('承認待ちがあるときは、承認する人にも人数をまとめて知らせる', () => {
    const approver = { id: 'a1', email: 'a1@example.com' };
    const out = planNotices(base({ today: '2026-11-05', claims: [claim(), claim({ title: '電車代' })], approversOf: new Map([['u1', [approver]]]) }));
    const toApprover = out.find(n => n.user.id === 'a1');
    expect(toApprover).toMatchObject({ rule: 'expense', stage: 'on', subject_key: 'expense-approve:2026-10' });
    expect(toApprover!.text).toContain('2件');
    expect(toApprover!.text).toContain('佐藤');
    expect(toApprover!.text).toContain('/approvals');
  });

  it('差戻しだけのときは承認者には送らない', () => {
    const out = planNotices(base({ today: '2026-11-05', claims: [claim({ status: 'rejected' })], approversOf: new Map([['u1', [{ id: 'a1', email: 'a1@example.com' }]]]) }));
    expect(out.map(n => n.user.id)).toEqual(['u1']);
  });

  it('日数の設定どおりに前の日を決める', () => {
    expect(planNotices(base({ today: '2026-11-04', config: on({ expense: { enabled: true, days_before: 1 } }), claims: [claim()] }))).toHaveLength(1);
  });

  it('期限を過ぎてから出した経費は次の期間の分として数える', () => {
    // 10月分の期限 11/05 のあとに申請した 10/10 の経費は 11月分（期限 12/05）
    expect(planNotices(base({ today: '2026-12-05', claims: [claim({ submitted: '2026-11-20' })] }))[0]).toMatchObject({ subject_key: 'expense:2026-11' });
  });
});

describe('オートフロー: 振込日', () => {
  const finance = [{ id: 'f1', email: 'f1@example.com' }, { id: 'f2', email: 'f2@example.com' }];
  const items = [
    { scheduled_date: '2026-11-25', amount: 300000, group: 'payroll' as const, blocker: null },
    { scheduled_date: '2026-11-25', amount: 12000, group: 'expense' as const, blocker: '受取口座が未確認' },
    { scheduled_date: '2026-12-25', amount: 999, group: 'payment' as const, blocker: null },
  ];
  const base = (over: Partial<PlanInput> = {}) => input({ reportWorkers: [], config: on({ report: { enabled: false } }), finance, payItems: items, ...over });

  it('振込日の3日前に、経理と管理者の全員へ件数と合計を知らせる', () => {
    const out = planNotices(base({ today: '2026-11-22' }));
    expect(out.map(n => n.user.id)).toEqual(['f1', 'f2']);
    expect(out[0]).toMatchObject({ rule: 'payment', stage: 'before', subject_key: 'payday:2026-11-25', type: 'payment_reminder' });
    expect(out[0].text).toContain('2件');
    expect(out[0].text).toContain('¥312,000');
    expect(out[0].text).toContain('給与・報酬 1件');
    expect(out[0].text).toContain('1件'); // 口座の問題
    expect(out[0].text).not.toContain('受取口座が未確認'); // 中身（口座）は載せない
  });

  it('振込日の当日にも知らせる。別の日の分は混ぜない', () => {
    const out = planNotices(base({ today: '2026-11-25' }));
    expect(out[0]).toMatchObject({ stage: 'on' });
    expect(out[0].text).not.toContain('¥999');
  });

  it('振込日と関係ない日は送らない。OFF なら送らない', () => {
    expect(planNotices(base({ today: '2026-11-20' }))).toHaveLength(0);
    expect(planNotices(base({ today: '2026-11-22', config: on({ payment: { enabled: false, days_before: 3 } }) }))).toHaveLength(0);
  });
});
