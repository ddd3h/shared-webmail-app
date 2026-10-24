import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    business_trips: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), delete: vi.fn() },
    trip_allowance_types: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    trip_allowance_lines: { deleteMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
    users: { count: vi.fn() },
    $transaction: vi.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops({}))),
  },
}));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'u1' })), requireAuth: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/work-auth', () => ({ getActor: vi.fn(), isAdmin: (a: any) => a.role === 'admin' }));
vi.mock('@/lib/work-notify', () => ({ notifyTripSubmitted: vi.fn(), notifyTripReviewed: vi.fn() }));

import { prisma } from '@/lib/db';
import { getActor } from '@/lib/work-auth';
import { notifyTripReviewed, notifyTripSubmitted } from '@/lib/work-notify';
import { GET as list, POST as create } from '@/app/api/trips/route';
import { PATCH as patch, DELETE as withdraw } from '@/app/api/trips/[id]/route';
import { POST as review } from '@/app/api/trips/[id]/review/route';
import { POST as cancel } from '@/app/api/trips/[id]/cancel/route';
import { POST as addType } from '@/app/api/trips/allowance-types/route';
import { DELETE as delType } from '@/app/api/trips/allowance-types/[id]/route';

const actor = (role = 'user') => ({ id: 'u1', name: '田中', role, worker_type: 'employee' });
const json = (b: object, method = 'POST') => new Request('http://x', { method, body: JSON.stringify(b) }) as any;
const ctx = { params: Promise.resolve({ id: 't1' }) };
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const trip = (o: object = {}) => ({ id: 't1', user_id: 'u1', status: 'pending', start_date: d('2026-10-28'), end_date: d('2026-10-30'), ...o });
const daily = { id: 'd1', name: '国内出張日当', kind: 'daily', unit: 'per_day', amount: 3000, is_active: true };
const lodging = { id: 'a1', name: '宿泊手当', kind: 'addon', unit: 'per_night', amount: 2000, is_active: true };
const body = (o: object = {}) => ({ destination: '名古屋', purpose: 'A社 システム導入', start_date: '2026-10-28', end_date: '2026-10-30', daily_type_id: 'd1', addon_type_ids: ['a1'], ...o });

beforeEach(() => {
  vi.resetAllMocks();
  (prisma.$transaction as any).mockImplementation(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops({})));
  (getActor as any).mockResolvedValue(actor());
  (prisma.business_trips.findMany as any).mockResolvedValue([]);
});

describe('出張申請', () => {
  it('日当と加算金を計算して保存し、管理者に通知する', async () => {
    (prisma.trip_allowance_types.findMany as any).mockResolvedValue([daily, lodging]);
    (prisma.business_trips.create as any).mockResolvedValue({ id: 't1' });
    const res = await create(json(body()));
    expect(res.status).toBe(201);
    const lines = (prisma.business_trips.create as any).mock.calls[0][0].data.allowances.create;
    expect(lines.map((l: any) => [l.name, l.quantity, l.amount])).toEqual([['国内出張日当', 3, 9000], ['宿泊手当', 2, 4000]]);
    expect(notifyTripSubmitted).toHaveBeenCalledWith('t1');
  });
  it('終了日が開始日より前なら400', async () => {
    expect((await create(json(body({ end_date: '2026-10-27' })))).status).toBe(400);
  });
  it('90日を超える期間は400', async () => {
    expect((await create(json(body({ end_date: '2027-03-01' })))).status).toBe(400);
  });
  it('日当を2つ選ぶと400', async () => {
    (prisma.trip_allowance_types.findMany as any).mockResolvedValue([daily, { ...daily, id: 'd2' }]);
    expect((await create(json(body({ addon_type_ids: ['d2'] })))).status).toBe(400);
  });
  it('存在しない・無効な手当を指定すると400', async () => {
    (prisma.trip_allowance_types.findMany as any).mockResolvedValue([daily]); // a1 は返らない = 無効
    expect((await create(json(body()))).status).toBe(400);
  });
  it('日当の欄に加算金を指定すると400', async () => {
    (prisma.trip_allowance_types.findMany as any).mockResolvedValue([lodging, daily]);
    expect((await create(json(body({ daily_type_id: 'a1', addon_type_ids: [] })))).status).toBe(400);
  });
  it('自分の別の出張と期間が重なると409', async () => {
    (prisma.trip_allowance_types.findMany as any).mockResolvedValue([daily, lodging]);
    (prisma.business_trips.findMany as any).mockResolvedValue([{ id: 'x', destination: '大阪', start_date: d('2026-10-29'), end_date: d('2026-11-01') }]);
    const res = await create(json(body()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('overlap');
    expect(prisma.business_trips.create).not.toHaveBeenCalled();
  });
  it('手当なしでも申請できる', async () => {
    (prisma.business_trips.create as any).mockResolvedValue({ id: 't1' });
    expect((await create(json(body({ daily_type_id: null, addon_type_ids: [] })))).status).toBe(201);
  });
});

describe('一覧', () => {
  it('一般ユーザーは全員分を見られない', async () => {
    expect((await list(new Request('http://x/api/trips?scope=all') as any)).status).toBe(403);
  });
  it('一般ユーザーの一覧は自分の出張に限定される', async () => {
    await list(new Request('http://x/api/trips?userId=u9') as any);
    expect((prisma.business_trips.findMany as any).mock.calls[0][0].where.user_id).toBe('u1');
  });
});

describe('承認', () => {
  const act = (b: object) => review(json(b), ctx);
  it('管理者以外は承認できない', async () => {
    expect((await act({ action: 'approve' })).status).toBe(403);
  });
  it('却下にはコメントが必要', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    expect((await act({ action: 'reject' })).status).toBe(400);
  });
  it('承認待ちでなければ409', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip({ user_id: 'u2', status: 'approved' }));
    expect((await act({ action: 'approve' })).status).toBe(409);
  });
  it('管理者が複数いるとき自分の出張は承認できない', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip());
    (prisma.users.count as any).mockResolvedValue(2);
    expect((await act({ action: 'approve' })).status).toBe(403);
  });
  it('他人の出張を承認して通知する', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip({ user_id: 'u2' }));
    (prisma.users.count as any).mockResolvedValue(2);
    (prisma.business_trips.updateMany as any).mockResolvedValue({ count: 1 });
    expect((await act({ action: 'approve' })).status).toBe(200);
    expect(notifyTripReviewed).toHaveBeenCalledWith('t1', 'approve');
  });
});

describe('編集・取り下げ・取消', () => {
  it('本人は承認済みの出張を編集できない', async () => {
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip({ status: 'approved' }));
    expect((await patch(json(body(), 'PATCH'), ctx)).status).toBe(409);
  });
  it('他人の出張は編集できない', async () => {
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip({ user_id: 'u2' }));
    expect((await patch(json(body(), 'PATCH'), ctx)).status).toBe(403);
  });
  it('却下された出張を編集すると再申請になる', async () => {
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip({ status: 'rejected' }));
    (prisma.trip_allowance_types.findMany as any).mockResolvedValue([daily, lodging]);
    expect((await patch(json(body(), 'PATCH'), ctx)).status).toBe(200);
    expect((prisma.business_trips.update as any).mock.calls[0][0].data).toMatchObject({ status: 'pending', review_comment: null });
    expect(notifyTripSubmitted).toHaveBeenCalledWith('t1', true);
  });
  it('管理者は他人の承認済み出張の手当だけ調整できる（日付は変わらない）', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip({ user_id: 'u2', status: 'approved' }));
    (prisma.trip_allowance_types.findMany as any).mockResolvedValue([daily]);
    const res = await patch(json({ destination: '変更', start_date: '2026-01-01', end_date: '2026-01-02', daily_type_id: 'd1', addon_type_ids: [] }, 'PATCH'), ctx);
    expect(res.status).toBe(200);
    expect(prisma.business_trips.update).not.toHaveBeenCalled();
    expect((prisma.trip_allowance_lines.createMany as any).mock.calls[0][0].data[0]).toMatchObject({ trip_id: 't1', quantity: 3, amount: 9000 });
  });
  it('承認済みは取り下げ(削除)できず、取消にする', async () => {
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip({ status: 'approved' }));
    expect((await withdraw(json({}, 'DELETE'), ctx)).status).toBe(409);
    (prisma.business_trips.updateMany as any).mockResolvedValue({ count: 1 });
    expect((await cancel(json({}), ctx)).status).toBe(200);
    expect((prisma.business_trips.updateMany as any).mock.calls[0][0].where).toEqual({ id: 't1', status: 'approved' });
  });
  it('承認済み以外は取消できない', async () => {
    (prisma.business_trips.findUnique as any).mockResolvedValue(trip());
    (prisma.business_trips.updateMany as any).mockResolvedValue({ count: 0 });
    expect((await cancel(json({}), ctx)).status).toBe(409);
  });
});

describe('手当マスタ', () => {
  it('管理者以外は追加できない', async () => {
    expect((await addType(json({ name: 'x', kind: 'addon', unit: 'per_day', amount: 100 }))).status).toBe(403);
  });
  it('使用済みの手当は削除ではなく無効化する', async () => {
    (getActor as any).mockResolvedValue(actor('admin'));
    (prisma.trip_allowance_types.findUnique as any).mockResolvedValue({ id: 'a1' });
    (prisma.trip_allowance_lines.count as any).mockResolvedValue(3);
    const res = await delType(json({}, 'DELETE'), { params: Promise.resolve({ id: 'a1' }) });
    expect((await res.json()).deactivated).toBe(true);
    expect(prisma.trip_allowance_types.delete).not.toHaveBeenCalled();
    expect(prisma.trip_allowance_types.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { is_active: false } });
  });
});
