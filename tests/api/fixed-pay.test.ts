import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    users: { findUnique: vi.fn(), findMany: vi.fn() },
    autoflow_notices: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    fixed_pay_plans: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    pay_extras: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    payslips: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    payslip_items: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock('@/lib/finance-guard', () => ({ financeActor: vi.fn(), forbidden: vi.fn(() => NextResponse.json({ error: 'forbidden' }, { status: 403 })) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/pay-schedule-server', async () => {
  const { DEFAULT_SCHEDULES } = await import('@/lib/pay-schedule');
  return { loadSchedules: vi.fn(async () => ({ schedules: DEFAULT_SCHEDULES, custom: new Set() })) };
});

import { GET as getPlans, POST as postPlan } from '@/app/api/autoflow/plans/route';
import { PUT as putPlan, DELETE as deletePlan } from '@/app/api/autoflow/plans/[id]/route';
import { POST as postExtra } from '@/app/api/autoflow/extras/route';
import { DELETE as deleteExtra } from '@/app/api/autoflow/extras/[id]/route';
import { POST as generate } from '@/app/api/autoflow/fixed/generate/route';
import { generateFixedDrafts } from '@/lib/fixed-pay-server';
import { prisma } from '@/lib/db';
import { financeActor } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';

const db = prisma as any;
const json = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/autoflow/x', { method, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const FINANCE = { id: 'fin1' };
const plan = { id: 'p1', user_id: 'u1', label: '役員報酬', amount: 500000, starts_month: '2026-04', ends_month: null, active: true, user: { id: 'u1', name: '山田', worker_type: 'executive' } };

beforeEach(() => {
  vi.clearAllMocks();
  (financeActor as any).mockResolvedValue(FINANCE);
  db.fixed_pay_plans.findMany.mockResolvedValue([]);
  db.pay_extras.findMany.mockResolvedValue([]);
  db.payslips.findUnique.mockResolvedValue(null);
  db.payslips.findFirst.mockResolvedValue(null);
  db.payslips.create.mockResolvedValue({ id: 'slip1' });
  db.autoflow_notices.findFirst.mockResolvedValue(null);
  db.autoflow_notices.create.mockResolvedValue({ id: 'claim1' });
  db.autoflow_notices.delete.mockResolvedValue({});
});

describe('権限', () => {
  it('経理・管理者以外は、どのAPIも 403', async () => {
    (financeActor as any).mockResolvedValue(null);
    expect((await getPlans()).status).toBe(403);
    expect((await postPlan(json({}))).status).toBe(403);
    expect((await putPlan(json({}, 'PUT'), ctx('p1'))).status).toBe(403);
    expect((await deletePlan(json({}, 'DELETE'), ctx('p1'))).status).toBe(403);
    expect((await postExtra(json({}))).status).toBe(403);
    expect((await deleteExtra(json({}, 'DELETE'), ctx('e1'))).status).toBe(403);
    expect((await generate(json({ month: '2026-10' }))).status).toBe(403);
    expect(db.payslips.create).not.toHaveBeenCalled();
  });
});

describe('固定報酬の登録', () => {
  const body = { user_id: 'u1', label: '役員報酬', amount: 500000, starts_month: '2026-04' };
  it('役員・準業務委託なら登録できて、監査ログに残る', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive' });
    db.fixed_pay_plans.create.mockResolvedValue({ id: 'p9' });
    const res = await postPlan(json(body));
    expect(res.status).toBe(201);
    expect(db.fixed_pay_plans.create.mock.calls[0][0].data).toMatchObject({ user_id: 'u1', amount: 500000, ends_month: null, active: true, created_by_id: 'fin1' });
    expect((logAudit as any).mock.calls[0][0].actionType).toBe('fixed_pay_plan_create');
  });
  it('従業員や業務委託は登録できない（成果で金額が変わる／給与計算が別）', async () => {
    for (const t of ['employee', 'contractor', 'part']) {
      db.users.findUnique.mockResolvedValue({ worker_type: t });
      const res = await postPlan(json(body));
      expect(res.status).toBe(400);
    }
    expect(db.fixed_pay_plans.create).not.toHaveBeenCalled();
  });
  it('同じ人の期間が重なる計画は 409（二重に払わない）', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive' });
    db.fixed_pay_plans.findMany.mockResolvedValue([{ starts_month: '2026-01', ends_month: null }]);
    expect((await postPlan(json(body))).status).toBe(409);
    expect(db.fixed_pay_plans.create).not.toHaveBeenCalled();
  });
  it('止めてある計画とは重なってよい', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive' });
    db.fixed_pay_plans.create.mockResolvedValue({ id: 'p9' });
    await postPlan(json(body));
    expect(db.fixed_pay_plans.findMany.mock.calls[0][0].where).toMatchObject({ active: true });
  });
  it('不正な入力は 400', async () => {
    expect((await postPlan(json({ ...body, amount: -5 }))).status).toBe(400);
    expect((await postPlan(json({ ...body, label: '役員賞与' }))).status).toBe(400);
  });
  it('変更では、別の人に付け替えられない', async () => {
    db.fixed_pay_plans.findUnique.mockResolvedValue(plan);
    expect((await putPlan(json({ ...body, user_id: 'u2' }, 'PUT'), ctx('p1'))).status).toBe(400);
    expect(db.fixed_pay_plans.update).not.toHaveBeenCalled();
  });
  it('変更では、自分自身とは重なっても構わない', async () => {
    db.fixed_pay_plans.findUnique.mockResolvedValue(plan);
    db.fixed_pay_plans.findMany.mockResolvedValue([]); // NOT: { id } で自分は除かれている
    const res = await putPlan(json({ ...body, amount: 520000 }, 'PUT'), ctx('p1'));
    expect(res.status).toBe(200);
    expect(db.fixed_pay_plans.findMany.mock.calls[0][0].where.NOT).toEqual({ id: 'p1' });
  });
});

describe('固定報酬の下書き', () => {
  const OCT_END = '2026-10-31';
  it('締め日に、有効な計画ごとに「支払予定」の下書きを1枚作る', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    const out = await generateFixedDrafts({ today: OCT_END });
    expect(out).toEqual([{ user_id: 'u1', user_name: '山田', month: '2026-10', label: '役員報酬', amount: 500000, status: 'new' }]);
    const data = db.payslips.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ user_id: 'u1', pay_month: '2026-10', title: '役員報酬', status: 'planned', auto_key: 'fixed:u1:2026-10' });
    expect(data.items.create).toEqual([{ kind: 'earning', label: '役員報酬', amount: 500000, sort: 0, system_key: null }]);
    expect(data.pay_date.toISOString().slice(0, 10)).toBe('2026-11-25');
  });
  it('締め日の翌日からは、前の月分を見る（すでにあれば作らない）', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.payslips.findUnique.mockResolvedValue({ id: 'already' });
    const out = await generateFixedDrafts({ today: '2026-11-03' });
    expect(out[0]).toMatchObject({ month: '2026-10', status: 'exists' });
    expect(db.payslips.create).not.toHaveBeenCalled();
  });
  it('その月に手で入れた明細（立替金精算・賞与以外）があれば、二重に払わないよう作らない', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.payslips.findFirst.mockResolvedValue({ id: 'manual' });
    const out = await generateFixedDrafts({ today: OCT_END });
    expect(out[0].status).toBe('conflict');
    expect(db.payslips.create).not.toHaveBeenCalled();
    const where = db.payslips.findFirst.mock.calls[0][0].where;
    expect(where.auto_key).toBeNull();
    expect(JSON.stringify(where.NOT)).toContain('立替金精算');
    expect(JSON.stringify(where.NOT)).toContain('賞与');
  });
  it('開始前・終了後の計画は作らない', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([{ ...plan, starts_month: '2026-11' }, { ...plan, id: 'p2', user_id: 'u2', ends_month: '2026-09', user: { id: 'u2', name: '佐藤', worker_type: 'executive' } }]);
    expect(await generateFixedDrafts({ today: OCT_END })).toEqual([]);
  });
  it('その月の加算は、下書きに行として入る', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.pay_extras.findMany.mockResolvedValue([{ id: 'x1', label: '通勤手当', amount: 8000 }]);
    await generateFixedDrafts({ today: OCT_END });
    expect(db.payslips.create.mock.calls[0][0].data.items.create[1]).toEqual({ kind: 'earning', label: '通勤手当', amount: 8000, sort: 10, system_key: 'addon:x1' });
  });
  it('dry なら何も作らない', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    const out = await generateFixedDrafts({ today: OCT_END, dry: true });
    expect(out[0].status).toBe('new');
    expect(db.payslips.create).not.toHaveBeenCalled();
  });
  it('別の実行が先に作っていたら（unique 違反）、エラーにせず「作成済み」', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.payslips.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    expect((await generateFixedDrafts({ today: OCT_END }))[0].status).toBe('exists');
  });
  it('ほかのエラーは握りつぶさない', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.payslips.create.mockRejectedValue(new Error('db down'));
    await expect(generateFixedDrafts({ today: OCT_END })).rejects.toThrow('db down');
  });
  it('ロックされた人の計画は読まない', async () => {
    await generateFixedDrafts({ today: OCT_END });
    expect(db.fixed_pay_plans.findMany.mock.calls[0][0].where).toMatchObject({ active: true, user: { locked_at: null } });
  });
  it('作ったときに「作った」印を残す（消された下書きを次の日に作り直さないため）', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    await generateFixedDrafts({ today: OCT_END });
    expect(db.autoflow_notices.create.mock.calls[0][0].data).toMatchObject({ rule: 'fixed', stage: 'draft', subject_key: 'fixed:u1:2026-10', user_id: 'u1' });
  });
  it('印があるのに下書きがない（経理が消した）月は、毎日の実行では作り直さない', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.autoflow_notices.findFirst.mockResolvedValue({ id: 'claim1' });
    const out = await generateFixedDrafts({ today: '2026-11-03' });
    expect(out[0]).toMatchObject({ month: '2026-10', status: 'skipped' });
    expect(db.payslips.create).not.toHaveBeenCalled();
  });
  it('経理が月を指定して押したときは、消した下書きも作り直せる', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.autoflow_notices.findFirst.mockResolvedValue({ id: 'claim1' });
    const body = await (await generate(json({ month: '2026-10' }))).json();
    expect(body.drafts[0].status).toBe('new');
    expect(db.payslips.create).toHaveBeenCalledTimes(1);
    expect(db.autoflow_notices.create).not.toHaveBeenCalled(); // 印は残っているので、足さない
  });
  it('別の実行が先に印を取ったときは、作らない', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.autoflow_notices.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    expect((await generateFixedDrafts({ today: OCT_END }))[0].status).toBe('exists');
    expect(db.payslips.create).not.toHaveBeenCalled();
  });
  it('下書きが作れなかったら、印を戻す（次の実行でやり直せる）', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.payslips.create.mockRejectedValue(new Error('db down'));
    await expect(generateFixedDrafts({ today: OCT_END })).rejects.toThrow('db down');
    expect(db.autoflow_notices.delete).toHaveBeenCalledWith({ where: { id: 'claim1' } });
  });
  it('プレビュー(dry)は、印を作らない', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    await generateFixedDrafts({ today: OCT_END, dry: true });
    expect(db.autoflow_notices.create).not.toHaveBeenCalled();
  });
  it('手動の作成は、指定した月の分を作る', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    const res = await generate(json({ month: '2026-07' }));
    const body = await res.json();
    expect(body.drafts[0]).toMatchObject({ month: '2026-07', status: 'new' });
    expect(db.payslips.create.mock.calls[0][0].data.created_by_id).toBe('fin1');
    expect((logAudit as any).mock.calls[0][0].actionType).toBe('fixed_pay_generate');
  });
  it('月の指定が不正なら 400', async () => {
    expect((await generate(json({ month: '2026-1' }))).status).toBe(400);
  });
});

describe('加算と賞与', () => {
  const ex = { user_id: 'u1', pay_month: '2026-10', kind: 'addon', label: '通勤手当', amount: 8000 };
  it('加算は、まだ全銀に入っていない下書きの行を作り直す', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: null });
    db.pay_extras.create.mockResolvedValue({ id: 'x1', ...ex });
    db.payslips.findUnique.mockResolvedValue({ id: 'slip1', status: 'planned', batch_id: null });
    db.pay_extras.findMany.mockResolvedValue([{ id: 'x1', label: '通勤手当', amount: 8000 }]);
    expect((await postExtra(json(ex))).status).toBe(201);
    expect(db.payslip_items.deleteMany.mock.calls[0][0].where).toMatchObject({ payslip_id: 'slip1', system_key: { startsWith: 'addon:' } });
    expect(db.payslip_items.createMany.mock.calls[0][0].data).toEqual([{ kind: 'earning', label: '通勤手当', amount: 8000, sort: 10, system_key: 'addon:x1', payslip_id: 'slip1' }]);
  });
  it('全銀に入った下書きは、加算を足しても触らない（金額がファイルと食い違うため）', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: null });
    db.pay_extras.create.mockResolvedValue({ id: 'x1', ...ex });
    db.payslips.findUnique.mockResolvedValue({ id: 'slip1', status: 'planned', batch_id: 'b1' });
    await postExtra(json(ex));
    expect(db.payslip_items.deleteMany).not.toHaveBeenCalled();
    expect(db.payslip_items.createMany).not.toHaveBeenCalled();
  });
  it('賞与は、別の「支払予定」の明細になり、題名に「賞与」が付く', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: null });
    db.pay_extras.create.mockResolvedValue({ id: 'x2', user_id: 'u1', pay_month: '2026-10', kind: 'bonus', label: '夏季ボーナス', amount: 300000 });
    expect((await postExtra(json({ ...ex, kind: 'bonus', label: '夏季ボーナス', amount: 300000 }))).status).toBe(201);
    const data = db.payslips.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: '賞与（夏季ボーナス）', status: 'planned', auto_key: 'bonus:x2', pay_month: '2026-10' });
    expect(data.items.create).toEqual([{ kind: 'earning', label: '夏季ボーナス', amount: 300000, sort: 0 }]);
  });
  it('題名にすでに「賞与」があれば、そのまま', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: null });
    db.pay_extras.create.mockResolvedValue({ id: 'x3', user_id: 'u1', pay_month: '2026-12', kind: 'bonus', label: '冬季賞与', amount: 1 });
    await postExtra(json({ ...ex, kind: 'bonus', pay_month: '2026-12', label: '冬季賞与', amount: 1 }));
    expect(db.payslips.create.mock.calls[0][0].data.title).toBe('冬季賞与');
  });
  it('加算を登録できるのは、役員・準業務委託だけ', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'employee', locked_at: null });
    expect((await postExtra(json(ex))).status).toBe(400);
    expect(db.pay_extras.create).not.toHaveBeenCalled();
  });
  it('ロックされた人には登録できない', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: new Date() });
    expect((await postExtra(json(ex))).status).toBe(404);
  });
  it('賞与を取り消すと、支払予定の明細も消える', async () => {
    db.pay_extras.findUnique.mockResolvedValue({ id: 'x2', user_id: 'u1', pay_month: '2026-10', kind: 'bonus', label: '夏季賞与', amount: 1 });
    db.payslips.findUnique.mockResolvedValue({ id: 'slip2', status: 'planned', batch_id: null });
    expect((await deleteExtra(json({}, 'DELETE'), ctx('x2'))).status).toBe(200);
    expect(db.payslips.delete).toHaveBeenCalledWith({ where: { id: 'slip2' } });
    expect(db.pay_extras.delete).toHaveBeenCalled();
  });
  it('全銀ファイルに入った賞与や、支払い済みの賞与は取り消せない（409）', async () => {
    db.pay_extras.findUnique.mockResolvedValue({ id: 'x2', user_id: 'u1', pay_month: '2026-10', kind: 'bonus', label: '夏季賞与', amount: 1 });
    for (const slip of [{ id: 's', status: 'planned', batch_id: 'b1' }, { id: 's', status: 'paid', batch_id: null }]) {
      db.payslips.findUnique.mockResolvedValue(slip);
      expect((await deleteExtra(json({}, 'DELETE'), ctx('x2'))).status).toBe(409);
    }
    expect(db.payslips.delete).not.toHaveBeenCalled();
    expect(db.pay_extras.delete).not.toHaveBeenCalled();
  });
});
