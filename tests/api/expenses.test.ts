import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    expense_claims: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    users: { count: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u1' })), requireAuth: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/work-notify', () => ({
  notifyExpenseSubmitted: vi.fn(), notifyExpenseReviewed: vi.fn(), notifyExpenseReimbursed: vi.fn(),
  notifyWorkReportSubmitted: vi.fn(), notifyPayslip: vi.fn(), notifyAttendanceEdited: vi.fn(), notifyExpenseAddedToPayslip: vi.fn(),
}));
vi.mock('@/lib/attachment-storage', () => ({ saveUploadedFiles: vi.fn(async () => []), deleteStoredFiles: vi.fn() }));
vi.mock('@/lib/trip-server', () => ({ checkTripLink: vi.fn() }));
vi.mock('@/lib/pay-schedule-server', () => ({ loadSchedules: vi.fn(async () => ({ schedules: {}, custom: new Set() })), planOf: vi.fn(() => ({ period: '2026-10', closing_date: '2026-10-31', deadline: '2026-11-05', pay_date: '2026-11-25', late: false })) }));
vi.mock('@/lib/work-auth', () => ({ getActor: vi.fn(), isAdmin: (a: any) => a.role === 'admin', isFinance: (a: any) => a.role === 'admin' || !!a.is_accounting }));
vi.mock('@/lib/org-server', () => ({ canReviewUser: vi.fn(async (a: any) => a.role === 'admin') }));

import { prisma } from '@/lib/db';
import { getActor } from '@/lib/work-auth';
import { canReviewUser } from '@/lib/org-server';
import { checkTripLink } from '@/lib/trip-server';
import { GET as list } from '@/app/api/expenses/route';
import { PATCH as edit } from '@/app/api/expenses/[id]/route';
import { POST as review } from '@/app/api/expenses/[id]/review/route';
import { POST as reimburse } from '@/app/api/expenses/reimburse/route';
import { notifyExpenseReviewed, notifyExpenseReimbursed, notifyExpenseSubmitted } from '@/lib/work-notify';

const actor = (role = 'user') => ({ id: 'u1', name: '田中', role, worker_type: 'employee' });
const json = (body: object) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as any;
const ctx = { params: Promise.resolve({ id: 'c1' }) };
const claim = (o: object = {}) => ({ id: 'c1', user_id: 'u2', status: 'pending', payment_method: 'personal', amount: 1200, ...o });

beforeEach(() => vi.resetAllMocks());

describe('一覧', () => {
  it('一般ユーザーは全員分(scope=all)を見られない', async () => {
    (getActor as any).mockResolvedValue(actor());
    expect((await list(new Request('http://x/api/expenses?scope=all') as any)).status).toBe(403);
  });
  it('一般ユーザーの一覧は自分の申請に限定される', async () => {
    (getActor as any).mockResolvedValue(actor());
    (prisma.expense_claims.findMany as any).mockResolvedValue([]);
    await list(new Request('http://x/api/expenses?userId=u9') as any);
    for (const c of (prisma.expense_claims.findMany as any).mock.calls) expect(c[0].where.user_id).toBe('u1');
  });
});

describe('編集', () => {
  const body = { expense_date: '2026-10-20', category: '交通費', title: '電車代', amount: 480, payment_method: 'personal' };
  const patch = () => edit(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as any, ctx);
  it('他人の申請は編集できない', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u2' }));
    expect((await patch()).status).toBe(403);
  });
  it('承認済みは編集できない', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u1', status: 'approved' }));
    expect((await patch()).status).toBe(409);
  });
  it('却下された申請を編集すると承認待ちに戻る', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u1', status: 'rejected' }));
    expect((await patch()).status).toBe(200);
    expect((prisma.expense_claims.update as any).mock.calls[0][0].data).toMatchObject({ status: 'pending', reviewed_by_id: null, review_comment: null });
    expect(notifyExpenseSubmitted).toHaveBeenCalledWith('c1', true);
  });
  it('他人の出張や未承認の出張には紐付けられない', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u1' }));
    (checkTripLink as any).mockResolvedValue(false);
    const res = await edit(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ ...body, trip_id: 't9' }) }) as any, ctx);
    expect(res.status).toBe(400);
    expect(prisma.expense_claims.update).not.toHaveBeenCalled();
  });
  it('承認済みの自分の出張には紐付けられる。nullで外せる', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u1' }));
    (checkTripLink as any).mockResolvedValue(true);
    await edit(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ ...body, trip_id: 't1' }) }) as any, ctx);
    expect((prisma.expense_claims.update as any).mock.calls[0][0].data.trip_id).toBe('t1');
    await edit(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ ...body, trip_id: null }) }) as any, ctx);
    expect((prisma.expense_claims.update as any).mock.calls[1][0].data.trip_id).toBeNull();
  });
  it('trip_idを送らなければ紐付けは変わらない', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u1' }));
    await edit(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as any, ctx);
    expect((prisma.expense_claims.update as any).mock.calls[0][0].data).not.toHaveProperty('trip_id');
  });
  it('存在しない区分は400', async () => {
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u1' }));
    const res = await edit(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ ...body, category: '遊興費' }) }) as any, ctx);
    expect(res.status).toBe(400);
  });
});

describe('承認', () => {
  it('管理者でも、申請者の部署長でもない人は承認できない', async () => {
    (getActor as any).mockResolvedValue(actor());
    (prisma.expense_claims.findUnique as any).mockResolvedValue({ id: 'c1', user_id: 'u2', status: 'pending', amount: 1000 });
    (canReviewUser as any).mockResolvedValue(false);
    expect((await review(json({ action: 'approve' }), ctx)).status).toBe(403);
    expect(prisma.expense_claims.updateMany).not.toHaveBeenCalled();
    expect(notifyExpenseReviewed).not.toHaveBeenCalled();
  });
  it('申請者の部署長（権限あり）は、管理者でなくても承認できる', async () => {
    (getActor as any).mockResolvedValue(actor());
    (prisma.expense_claims.findUnique as any).mockResolvedValue({ id: 'c1', user_id: 'u2', status: 'pending', amount: 1000 });
    (prisma.expense_claims.updateMany as any).mockResolvedValue({ count: 1 });
    (canReviewUser as any).mockResolvedValue(true);
    expect((await review(json({ action: 'approve' }), ctx)).status).toBe(200);
    expect(canReviewUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'u2');
    expect(notifyExpenseReviewed).toHaveBeenCalledWith('c1', 'approve');
  });
  it('却下にはコメントが必要', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    expect((await review(json({ action: 'reject' }), ctx)).status).toBe(400);
  });
  it('承認待ちでなければ409', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ status: 'approved' }));
    expect((await review(json({ action: 'approve' }), ctx)).status).toBe(409);
  });
  it('管理者が複数いるとき自分の申請は承認できない', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u1' }));
    (prisma.users.count as any).mockResolvedValue(2);
    expect((await review(json({ action: 'approve' }), ctx)).status).toBe(403);
    expect(prisma.expense_claims.updateMany).not.toHaveBeenCalled();
  });
  it('管理者が1人だけなら自分の申請も承認できる', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim({ user_id: 'u1' }));
    (prisma.users.count as any).mockResolvedValue(1);
    (prisma.expense_claims.updateMany as any).mockResolvedValue({ count: 1 });
    expect((await review(json({ action: 'approve' }), ctx)).status).toBe(200);
  });
  it('他人の申請を承認できる', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.expense_claims.findUnique as any).mockResolvedValue(claim());
    (prisma.users.count as any).mockResolvedValue(2);
    (prisma.expense_claims.updateMany as any).mockResolvedValue({ count: 1 });
    expect((await review(json({ action: 'approve' }), ctx)).status).toBe(200);
    expect((prisma.expense_claims.updateMany as any).mock.calls[0][0].data.status).toBe('approved');
    expect(notifyExpenseReviewed).toHaveBeenCalledWith('c1', 'approve');
  });
});

describe('立替金の返金', () => {
  it('管理者以外は返金処理できない', async () => {
    (getActor as any).mockResolvedValue(actor());
    expect((await reimburse(json({ ids: ['c1'] }))).status).toBe(403);
  });
  it('承認済みの立替だけを返金済にし、それ以外はスキップとして返す', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.expense_claims.findMany as any).mockResolvedValue([{ id: 'c1', user_id: 'u2', amount: 1200 }]);
    (prisma.expense_claims.updateMany as any).mockResolvedValue({ count: 1 });
    const res = await reimburse(json({ ids: ['c1', 'c2'], paid_date: '2026-10-25' }));
    expect(await res.json()).toEqual({ reimbursed: 1, attached: 0, skipped: 1 });
    expect((prisma.expense_claims.findMany as any).mock.calls[0][0].where).toMatchObject({ status: 'approved', payment_method: 'personal', payslip_id: null });
    expect((prisma.expense_claims.updateMany as any).mock.calls[0][0].data).toMatchObject({ status: 'paid', reimbursed_by_id: 'u1' });
    expect(notifyExpenseReimbursed).toHaveBeenCalledWith(['c1'], '2026-10-25', undefined);
  });
  it('ids が空なら400', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    expect((await reimburse(json({ ids: [] }))).status).toBe(400);
  });
});
