import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULES } from '@/lib/pay-schedule';
import { mergeReports, oneReportPerPeriod, periodSpan, type ReportRow } from '@/lib/work-reports';

const row = (id: string, date: string, title: string, over: Partial<ReportRow> = {}): ReportRow => ({
  id, user_id: 'u1', report_date: date, title, content: `${title}の内容`, hours: null, activity_flag: false, activity_note: null, created_at: new Date(`${date}T03:00:00Z`), ...over,
});

describe('oneReportPerPeriod', () => {
  it('準業務委託だけが、1期間に1通', () => {
    expect(oneReportPerPeriod('quasi_contractor')).toBe(true);
    expect(oneReportPerPeriod('contractor')).toBe(false);
    expect(oneReportPerPeriod('employee')).toBe(false);
  });
});

describe('periodSpan（締め日で区切った月）', () => {
  it('末日締めなら、暦の月', () => {
    expect(periodSpan('2026-10-15', DEFAULT_SCHEDULES.quasi_contractor)).toEqual({ period: '2026-10', start: '2026-10-01', end: '2026-10-31' });
  });
  it('15日締めなら、前月16日〜15日', () => {
    const s = { ...DEFAULT_SCHEDULES.quasi_contractor, closing_day: 15 };
    expect(periodSpan('2026-10-15', s)).toEqual({ period: '2026-10', start: '2026-09-16', end: '2026-10-15' });
    expect(periodSpan('2026-10-16', s)).toEqual({ period: '2026-11', start: '2026-10-16', end: '2026-11-15' });
  });
});

describe('mergeReports（1か月に何通も出した報告書を1通に）', () => {
  const rows = [
    row('c', '2026-10-20', '第3週', { hours: 10, created_at: new Date('2026-10-21T00:00:00Z') }),
    row('a', '2026-10-06', '第1週', { hours: 8.5, created_at: new Date('2026-10-07T00:00:00Z') }),
    row('b', '2026-10-13', '第2週', { hours: null, created_at: new Date('2026-10-14T00:00:00Z') }),
  ];
  it('いちばん古い提出を残し、ほかは消す対象。日付は最後に報告した日', () => {
    const m = mergeReports('2026-10', rows);
    expect(m.keep_id).toBe('a');
    expect(m.remove_ids.sort()).toEqual(['b', 'c']);
    expect(m.report_date).toBe('2026-10-20');
    expect(m.title).toBe('10月分 業務報告');
  });
  it('内容は、日付順に、日付と件名をつけて全部入る', () => {
    const m = mergeReports('2026-10', rows);
    expect(m.content).toBe('■ 2026-10-06 第1週\n第1週の内容\n\n■ 2026-10-13 第2週\n第2週の内容\n\n■ 2026-10-20 第3週\n第3週の内容');
  });
  it('稼働時間は合計（未入力は無視）。全部未入力なら未入力のまま', () => {
    expect(mergeReports('2026-10', rows).hours).toBe(18.5);
    expect(mergeReports('2026-10', [row('x', '2026-10-01', 'a'), row('y', '2026-10-02', 'b')]).hours).toBeNull();
  });
  it('「ログインの記録なし」の印は残り、理由はまとまる', () => {
    const m = mergeReports('2026-10', [row('x', '2026-10-01', 'a', { activity_flag: true, activity_note: '14日ログインなし' }), row('y', '2026-10-02', 'b'), row('z', '2026-10-03', 'c', { activity_flag: true, activity_note: '14日ログインなし' })]);
    expect(m.activity_flag).toBe(true);
    expect(m.activity_note).toBe('14日ログインなし');
    expect(mergeReports('2026-10', rows).activity_flag).toBe(false);
  });
});
