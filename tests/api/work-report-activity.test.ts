import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    work_reports: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    login_logs: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), requireAuth: vi.fn() }));
vi.mock('@/lib/work-auth', () => ({ getActor: vi.fn(), isFinance: vi.fn(() => false) }));
vi.mock('@/lib/work-notify', () => ({ notifyWorkReportSubmitted: vi.fn() }));
vi.mock('@/lib/pay-schedule-server', () => ({ loadSchedules: vi.fn(), planOf: vi.fn() }));
vi.mock('@/lib/work-reports-server', () => ({ reportInPeriod: vi.fn(async () => null) })); // the one-report-a-month rule is covered by e2e/quasi-reports.spec.ts
vi.mock('@/lib/autoflow/config-server', () => ({ loadConfig: vi.fn() }));

import { POST } from '@/app/api/work/reports/route';
import { PATCH } from '@/app/api/work/reports/[id]/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActor } from '@/lib/work-auth';
import { notifyWorkReportSubmitted } from '@/lib/work-notify';
import { loadConfig } from '@/lib/autoflow/config-server';

const db = prisma as any;
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/work/reports', { method: 'POST', body: JSON.stringify(body) }));
const patch = (body: unknown) => PATCH(new NextRequest('http://localhost/api/work/reports/r1', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'r1' }) });
const report = { report_date: '2026-10-10', title: '10月第2週', content: '作業しました' };
const login = (iso: string | null) => db.login_logs.findFirst.mockResolvedValue(iso ? { created_at: new Date(iso) } : null);

beforeEach(() => {
  vi.clearAllMocks();
  (getSession as any).mockResolvedValue({ userId: 'q1' });
  (getActor as any).mockResolvedValue({ id: 'q1', worker_type: 'quasi_contractor' });
  (loadConfig as any).mockResolvedValue({ activity: { enabled: true, days: 14 } });
  db.work_reports.create.mockResolvedValue({ id: 'r1' });
  db.work_reports.update.mockResolvedValue({});
});

describe('準業務委託の報告書: ログインの記録がない日の報告', () => {
  it('直近14日にログインがなければ、保存せずに警告を返す（409）', async () => {
    login('2026-09-01T03:00:00Z');
    const res = await post(report);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'activity_warning', days: 14, last_login: '2026-09-01' });
    expect(db.work_reports.create).not.toHaveBeenCalled();
    expect(notifyWorkReportSubmitted).not.toHaveBeenCalled();
  });

  it('警告を読んで提出する（activity_ack）と、警告の印つきで保存する', async () => {
    login('2026-09-01T03:00:00Z');
    const res = await post({ ...report, activity_ack: true });
    expect(res.status).toBe(201);
    expect(db.work_reports.create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: 'q1', activity_flag: true, activity_note: expect.stringContaining('2026-09-01'), activity_ack_at: expect.any(Date) }) });
    expect(notifyWorkReportSubmitted).toHaveBeenCalledWith('r1');
  });

  it('ログインの記録が1回もなくても、同じく警告する', async () => {
    login(null);
    const res = await post(report);
    expect(res.status).toBe(409);
    expect((await res.json()).last_login).toBeNull();
  });

  it('直近にログインがあれば、警告なしでそのまま保存する（印は付けない）', async () => {
    login('2026-10-09T03:00:00Z');
    const res = await post(report);
    expect(res.status).toBe(201);
    expect(db.work_reports.create.mock.calls[0][0].data).not.toHaveProperty('activity_flag');
  });

  it('その日の後のログインは数えない（日付をさかのぼって、報告日までを見る）', async () => {
    // 報告日 10/10 の終わり(JST)より前の最後のログインを探す。DB への問い合わせ条件を確かめる
    login('2026-10-09T03:00:00Z');
    await post(report);
    const where = db.login_logs.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ user_id: 'q1', success: true });
    expect(where.created_at.lt.toISOString()).toBe('2026-10-10T15:00:00.000Z'); // 10/11 00:00 JST
  });

  it('業務委託（準でない）や、設定が OFF のときは、確認しない', async () => {
    (getActor as any).mockResolvedValue({ id: 'c1', worker_type: 'contractor' });
    login(null);
    expect((await post(report)).status).toBe(201);
    (getActor as any).mockResolvedValue({ id: 'q1', worker_type: 'quasi_contractor' });
    (loadConfig as any).mockResolvedValue({ activity: { enabled: false, days: 14 } });
    expect((await post(report)).status).toBe(201);
    expect(db.login_logs.findFirst).not.toHaveBeenCalled();
  });
});

describe('準業務委託の報告書を直すとき', () => {
  beforeEach(() => {
    db.work_reports.findUnique.mockResolvedValue({ id: 'r1', user_id: 'q1', report_date: new Date('2026-10-10T00:00:00Z'), activity_flag: true });
  });

  it('日付を変えずに本文だけ直すときは、調べ直さず、前の印をそのまま残す', async () => {
    const res = await patch({ ...report, content: '直しました' });
    expect(res.status).toBe(200);
    expect(db.login_logs.findFirst).not.toHaveBeenCalled();
    expect(db.work_reports.update.mock.calls[0][0].data).not.toHaveProperty('activity_flag');
  });

  it('日付を、ログインの記録がない日に変えるときは、警告する', async () => {
    login('2026-09-01T03:00:00Z');
    const res = await patch({ ...report, report_date: '2026-10-20' });
    expect(res.status).toBe(409);
    expect(db.work_reports.update).not.toHaveBeenCalled();
  });

  it('警告を読んだうえなら、新しい日付で印をつけ直して保存する', async () => {
    login('2026-09-01T03:00:00Z');
    await patch({ ...report, report_date: '2026-10-20', activity_ack: true });
    expect(db.work_reports.update.mock.calls[0][0].data).toMatchObject({ activity_flag: true, activity_ack_at: expect.any(Date) });
  });

  it('ログインのあった日に変えたら、印を外す', async () => {
    login('2026-10-05T03:00:00Z');
    await patch({ ...report, report_date: '2026-10-06' });
    expect(db.work_reports.update.mock.calls[0][0].data).toMatchObject({ activity_flag: false, activity_note: null, activity_ack_at: null });
  });
});
