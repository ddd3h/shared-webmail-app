import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    attendance_records: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    work_reports: { create: vi.fn(), findMany: vi.fn() },
    payslips: { findMany: vi.fn(), create: vi.fn() },
    users: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ userId: 'u1' })),
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/work-notify', () => ({
  notifyExpenseSubmitted: vi.fn(), notifyExpenseReviewed: vi.fn(), notifyExpenseReimbursed: vi.fn(),
  notifyWorkReportSubmitted: vi.fn(), notifyPayslip: vi.fn(), notifyAttendanceEdited: vi.fn(), notifyExpenseAddedToPayslip: vi.fn(),
}));
vi.mock('@/lib/work-auth', () => ({
  getActor: vi.fn(),
  isAdmin: (a: any) => a.role === 'admin',
  isFinance: (a: any) => a.role === 'admin' || !!a.is_accounting,
  getWorkSettings: vi.fn(async () => ({ daily_minutes: 480, auto_break_minutes: 60 })),
}));

import { prisma } from '@/lib/db';
import { getActor } from '@/lib/work-auth';
import { POST as punch } from '@/app/api/work/attendance/punch/route';
import { POST as postReport } from '@/app/api/work/reports/route';
import { GET as getPayslips, POST as postPayslip } from '@/app/api/work/payslips/route';
import { PATCH as patchType } from '@/app/api/work/users/[id]/route';

const actor = (worker_type: string, role = 'user') => ({ id: 'u1', name: '田中', role, worker_type });
const json = (url: string, body: object, method = 'POST') => new Request(url, { method, body: JSON.stringify(body) }) as any;

beforeEach(() => vi.resetAllMocks());

describe('打刻', () => {
  const clockIn = () => punch(json('http://x', { action: 'clock_in' }));

  it('業務委託・役員は打刻できない', async () => {
    for (const t of ['contractor', 'executive']) {
      (getActor as any).mockResolvedValue(actor(t));
      expect((await clockIn()).status).toBe(403);
    }
    expect(prisma.attendance_records.upsert).not.toHaveBeenCalled();
  });
  it('従業員は出勤できる', async () => {
    (getActor as any).mockResolvedValue(actor('employee'));
    (prisma.attendance_records.findFirst as any).mockResolvedValue(null);
    (prisma.attendance_records.findUnique as any).mockResolvedValue(null);
    expect((await clockIn()).status).toBe(200);
    expect(prisma.attendance_records.upsert).toHaveBeenCalled();
  });
  it('出勤していないのに退勤は409', async () => {
    (getActor as any).mockResolvedValue(actor('employee'));
    (prisma.attendance_records.findFirst as any).mockResolvedValue(null);
    (prisma.attendance_records.findUnique as any).mockResolvedValue(null);
    expect((await punch(json('http://x', { action: 'clock_out' }))).status).toBe(409);
  });
  it('出勤済みの二重出勤は409', async () => {
    (getActor as any).mockResolvedValue(actor('employee'));
    (prisma.attendance_records.findFirst as any).mockResolvedValue({ id: 'a1', clock_in_at: new Date(), clock_out_at: null, break_started_at: null });
    expect((await clockIn()).status).toBe(409);
  });
});

describe('業務報告書', () => {
  const body = { report_date: '2026-10-20', title: '9月分の開発', content: '実装しました', hours: 6.5 };
  it('従業員は提出できない', async () => {
    (getActor as any).mockResolvedValue(actor('employee'));
    expect((await postReport(json('http://x', body))).status).toBe(403);
  });
  it('業務委託は提出できる', async () => {
    (getActor as any).mockResolvedValue(actor('contractor'));
    (prisma.work_reports.create as any).mockResolvedValue({ id: 'r1' });
    expect((await postReport(json('http://x', body))).status).toBe(201);
  });
  it('内容が空なら400', async () => {
    (getActor as any).mockResolvedValue(actor('contractor'));
    expect((await postReport(json('http://x', { ...body, content: ' ' }))).status).toBe(400);
  });
});

describe('給与明細', () => {
  it('一般ユーザーは他人のuserIdを指定しても自分の分しか見えない', async () => {
    (getActor as any).mockResolvedValue(actor('employee'));
    (prisma.payslips.findMany as any).mockResolvedValue([]);
    await getPayslips(new Request('http://x/api/work/payslips?userId=someone-else') as any);
    for (const call of (prisma.payslips.findMany as any).mock.calls) {
      expect(call[0].where.user_id).toBe('u1');
    }
  });
  it('管理者はuserIdで絞り込める', async () => {
    (getActor as any).mockResolvedValue(actor('executive', 'admin'));
    (prisma.payslips.findMany as any).mockResolvedValue([]);
    await getPayslips(new Request('http://x/api/work/payslips?userId=u9') as any);
    expect((prisma.payslips.findMany as any).mock.calls[0][0].where.user_id).toBe('u9');
  });
  it('管理者でもmine=1なら自分の明細だけ返す', async () => {
    (getActor as any).mockResolvedValue(actor('employee', 'admin'));
    (prisma.payslips.findMany as any).mockResolvedValue([]);
    await getPayslips(new Request('http://x/api/work/payslips?mine=1&userId=u9') as any);
    for (const call of (prisma.payslips.findMany as any).mock.calls) expect(call[0].where.user_id).toBe('u1');
  });
  it('金額と手取りを計算して返す', async () => {
    (getActor as any).mockResolvedValue(actor('employee'));
    const row = {
      id: 'p1', user: { id: 'u1', name: '田中', worker_type: 'employee' }, pay_month: '2026-10', title: '給与',
      status: 'planned', pay_date: null, note: null, created_at: new Date(), expense_claims: [],
      items: [{ id: 'i1', kind: 'earning', label: '基本給', amount: 300000 }, { id: 'i2', kind: 'deduction', label: '社会保険', amount: 45000 }],
    };
    (prisma.payslips.findMany as any).mockResolvedValue([row]);
    const body = await (await getPayslips(new Request('http://x/api/work/payslips?month=2026-10') as any)).json();
    expect(body.items[0].net).toBe(255000);
    expect(body.summary.planned_total).toBe(255000);
  });
  it('一般ユーザーは明細を登録できない', async () => {
    (getActor as any).mockResolvedValue(actor('employee'));
    const res = await postPayslip(json('http://x', { userId: 'u2', pay_month: '2026-10', items: [{ kind: 'earning', label: '基本給', amount: 1 }] }));
    expect(res.status).toBe(403);
    expect(prisma.payslips.create).not.toHaveBeenCalled();
  });
  it('管理者は登録できる。負の金額は400', async () => {
    (getActor as any).mockImplementation(async (id: string) => id === 'u1' ? actor('executive', 'admin') : { id, name: 'x', role: 'user', worker_type: 'employee' });
    (prisma.payslips.create as any).mockResolvedValue({ id: 'p1' });
    const ok = { userId: 'u2', pay_month: '2026-10', items: [{ kind: 'earning', label: '基本給', amount: 300000 }] };
    expect((await postPayslip(json('http://x', ok))).status).toBe(201);
    expect((await postPayslip(json('http://x', { ...ok, items: [{ kind: 'earning', label: '基本給', amount: -1 }] }))).status).toBe(400);
  });
});

describe('区分の設定', () => {
  const call = () => patchType(json('http://x', { worker_type: 'contractor' }, 'PATCH'), { params: Promise.resolve({ id: 'u2' }) });
  it('管理者以外は変更できない', async () => {
    (getActor as any).mockResolvedValue(actor('employee'));
    expect((await call()).status).toBe(403);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });
  it('管理者は変更できる', async () => {
    (getActor as any).mockResolvedValue(actor('executive', 'admin'));
    (prisma.users.findUnique as any).mockResolvedValue({ id: 'u2', worker_type: 'employee' });
    expect((await call()).status).toBe(200);
    expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 'u2' }, data: { worker_type: 'contractor' } });
  });
});
