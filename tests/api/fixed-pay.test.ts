import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    users: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    autoflow_notices: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    fixed_pay_plans: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    pay_extras: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    payslips: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    payroll_profiles: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    payslip_items: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock('@/lib/finance-guard', () => ({ financeActor: vi.fn(), forbidden: vi.fn(() => NextResponse.json({ error: 'forbidden' }, { status: 403 })) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/autoflow/config-server', () => ({ loadConfig: vi.fn() }));
vi.mock('@/lib/pay-schedule-server', async () => {
  const { DEFAULT_SCHEDULES } = await import('@/lib/pay-schedule');
  return { loadSchedules: vi.fn(async () => ({ schedules: DEFAULT_SCHEDULES, custom: new Set() })) };
});

import { GET as getPlans, POST as postPlan } from '@/app/api/autoflow/plans/route';
import { PUT as putPlan, DELETE as deletePlan } from '@/app/api/autoflow/plans/[id]/route';
import { POST as postExtra } from '@/app/api/autoflow/extras/route';
import { DELETE as deleteExtra } from '@/app/api/autoflow/extras/[id]/route';
import { POST as generate } from '@/app/api/autoflow/fixed/generate/route';
import { POST as recalc } from '@/app/api/autoflow/deductions/recalc/route';
import { POST as estimate } from '@/app/api/autoflow/deductions/estimate/route';
import { PUT as putProfile } from '@/app/api/autoflow/profiles/[userId]/route';
import { generateFixedDrafts } from '@/lib/fixed-pay-server';
import { DEFAULT_CONFIG, type AutoflowConfig } from '@/lib/autoflow/config';
import { loadConfig } from '@/lib/autoflow/config-server';
import { prisma } from '@/lib/db';
import { financeActor } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';

const db = prisma as any;
const json = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/autoflow/x', { method, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const FINANCE = { id: 'fin1' };
const plan = { id: 'p1', user_id: 'u1', label: '役員報酬', amount: 500000, commute_amount: 0, starts_month: '2026-04', ends_month: null, active: true, user: { id: 'u1', name: '山田', worker_type: 'executive', withholding_class: 'ko' } };
const withDeductions: AutoflowConfig = { ...DEFAULT_CONFIG, deductions: { enabled: true, prefecture: '東京都', timing: 'next' } };
// 51歳（介護保険の対象）、標準報酬月額 50万円、扶養親族等 0人
const profile = { user_id: 'u1', birth_date: new Date('1975-03-20T00:00:00Z'), health_insured: true, employment_insured: true, standard_monthly: 500000, dependents: 0, resident_tax: 0, resident_tax_first: null };

beforeEach(() => {
  vi.clearAllMocks();
  (financeActor as any).mockResolvedValue(FINANCE);
  db.fixed_pay_plans.findMany.mockResolvedValue([]);
  db.pay_extras.findMany.mockResolvedValue([]);
  db.payroll_profiles.findMany.mockResolvedValue([]);
  (loadConfig as any).mockResolvedValue(DEFAULT_CONFIG);
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
  it('役員・社員・準業務委託なら登録できて、監査ログに残る。通勤手当も一緒に登録できる', async () => {
    for (const t of ['executive', 'employee', 'regular', 'part', 'quasi_contractor']) {
      db.users.findUnique.mockResolvedValue({ worker_type: t });
      db.fixed_pay_plans.create.mockResolvedValue({ id: 'p9' });
      expect((await postPlan(json({ ...body, commute_amount: 12000 }))).status).toBe(201);
    }
    expect(db.fixed_pay_plans.create.mock.calls[0][0].data).toMatchObject({ user_id: 'u1', amount: 500000, commute_amount: 12000, ends_month: null, active: true, created_by_id: 'fin1' });
    expect((logAudit as any).mock.calls[0][0].actionType).toBe('fixed_pay_plan_create');
  });
  it('通勤手当を省くと 0。マイナスは 400', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive' });
    db.fixed_pay_plans.create.mockResolvedValue({ id: 'p9' });
    await postPlan(json(body));
    expect(db.fixed_pay_plans.create.mock.calls[0][0].data.commute_amount).toBe(0);
    expect((await postPlan(json({ ...body, commute_amount: -1 }))).status).toBe(400);
  });
  it('派遣と業務委託は登録できない（派遣は派遣元が払う／業務委託は成果で金額が変わる）', async () => {
    for (const t of ['dispatch', 'contractor']) {
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
    expect(out).toEqual([{ user_id: 'u1', user_name: '山田', month: '2026-10', label: '役員報酬', amount: 500000, status: 'new' }]); // 控除の自動計算がOFFなら、控除の項目は付かない
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
    expect(db.payslips.create.mock.calls[0][0].data.items.create[1]).toEqual({ kind: 'earning', label: '通勤手当', amount: 8000, sort: 10, system_key: null });
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
  // 下書き: 固定の月額（sort 0）と、経費から連動した立替金精算の行（system_key あり）
  const draft = (over: object = {}) => ({
    id: 'slip1', status: 'planned', batch_id: null, auto_edited: false, note: '下書きです', pay_date: new Date('2026-11-25T00:00:00Z'),
    items: [
      { kind: 'earning', label: '役員報酬', amount: 500000, sort: 0, system_key: null },
      { kind: 'earning', label: '立替金精算（1件）', amount: 3000, sort: 1000, system_key: 'expense_reimbursement' },
    ],
    user: { worker_type: 'executive', withholding_class: 'ko' }, ...over,
  });
  it('加算は、手を入れていない下書きの行を作り直す（立替金の行は残す）', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: null });
    db.pay_extras.create.mockResolvedValue({ id: 'x1', ...ex });
    db.payslips.findUnique.mockResolvedValue(draft());
    db.pay_extras.findMany.mockResolvedValue([{ id: 'x1', label: '通勤手当', amount: 8000 }]);
    const res = await postExtra(json(ex));
    expect(res.status).toBe(201);
    expect((await res.json()).reflect).toBe('done');
    expect(db.payslip_items.deleteMany.mock.calls[0][0].where).toEqual({ payslip_id: 'slip1', system_key: null });
    expect(db.payslip_items.createMany.mock.calls[0][0].data).toEqual([
      { kind: 'earning', label: '役員報酬', amount: 500000, sort: 0, system_key: null, payslip_id: 'slip1' },
      { kind: 'earning', label: '通勤手当', amount: 8000, sort: 10, system_key: null, payslip_id: 'slip1' },
    ]);
  });
  it('経理が明細を直したあとの下書きは、加算を足しても触らない（直した内容が消えるため）', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: null });
    db.pay_extras.create.mockResolvedValue({ id: 'x1', ...ex });
    db.payslips.findUnique.mockResolvedValue(draft({ auto_edited: true }));
    const res = await postExtra(json(ex));
    expect((await res.json()).reflect).toBe('edited');
    expect(db.payslip_items.deleteMany).not.toHaveBeenCalled();
    expect(db.payslip_items.createMany).not.toHaveBeenCalled();
  });
  it('全銀に入った下書きや、支払済みの下書きは、加算を足しても触らない（金額がファイルと食い違うため）', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: null });
    db.pay_extras.create.mockResolvedValue({ id: 'x1', ...ex });
    for (const over of [{ batch_id: 'b1' }, { status: 'paid' }]) {
      db.payslips.findUnique.mockResolvedValue(draft(over));
      expect((await (await postExtra(json(ex))).json()).reflect).toBe('locked');
    }
    expect(db.payslip_items.deleteMany).not.toHaveBeenCalled();
    expect(db.payslip_items.createMany).not.toHaveBeenCalled();
  });
  it('まだ下書きがなければ、反映するものはない（下書きができるときに入る）', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'executive', locked_at: null });
    db.pay_extras.create.mockResolvedValue({ id: 'x1', ...ex });
    expect((await (await postExtra(json(ex))).json()).reflect).toBe('none');
  });
  it('加算を取り消すと、手を入れていない下書きから行が消える', async () => {
    db.pay_extras.findUnique.mockResolvedValue({ id: 'x1', ...ex, kind: 'addon' });
    db.payslips.findUnique.mockResolvedValue(draft());
    db.pay_extras.findMany.mockResolvedValue([]);
    const res = await deleteExtra(json({}, 'DELETE'), ctx('x1'));
    expect((await res.json()).reflect).toBe('done');
    expect(db.payslip_items.createMany.mock.calls[0][0].data).toEqual([{ kind: 'earning', label: '役員報酬', amount: 500000, sort: 0, system_key: null, payslip_id: 'slip1' }]);
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
  it('加算を登録できるのは、固定報酬の対象の区分だけ（業務委託・派遣は不可）', async () => {
    db.users.findUnique.mockResolvedValue({ worker_type: 'contractor', locked_at: null });
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

describe('控除の自動計算', () => {
  const OCT_END = '2026-10-31';
  const itemsOf = () => db.payslips.create.mock.calls[0][0].data.items.create as { kind: string; label: string; amount: number; sort: number; system_key: null }[];
  const deductionsOf = () => Object.fromEntries(itemsOf().filter(i => i.kind === 'deduction').map(i => [i.label, i.amount]));

  it('OFFなら、下書きに控除は入らない', async () => {
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.payroll_profiles.findMany.mockResolvedValue([profile]);
    await generateFixedDrafts({ today: OCT_END });
    expect(itemsOf().every(i => i.kind === 'earning')).toBe(true);
    expect(db.payroll_profiles.findMany).not.toHaveBeenCalled();
  });

  it('ONなら、社会保険料・雇用保険料・所得税の行が支給のあとに入り、計算の根拠がメモに残る', async () => {
    (loadConfig as any).mockResolvedValue(withDeductions);
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.payroll_profiles.findMany.mockResolvedValue([profile]);
    const out = await generateFixedDrafts({ today: OCT_END });
    // 払う日は 2026-11-25、翌月徴収なので 10月分の保険料
    expect(deductionsOf()).toMatchObject({ '健康保険料': 24625, '子ども・子育て支援金': 575, '厚生年金保険料': 45750, '雇用保険料': 2500 });
    expect(deductionsOf()['介護保険料']).toBeGreaterThan(0);
    expect(Object.keys(deductionsOf()).at(-1)).toBe('所得税（甲欄）');
    expect(itemsOf().filter(i => i.kind === 'deduction').every(i => i.sort >= 100 && i.system_key === null)).toBe(true);
    const data = db.payslips.create.mock.calls[0][0].data;
    expect(data.note).toContain('概算');
    expect(data.note).toContain('【自動計算】');
    expect(data.note).toContain('2026-10分');
    expect(out[0].deductions).toBe(Object.values(deductionsOf()).reduce((a, b) => a + b, 0));
    expect(out[0].warnings).toEqual([]);
  });

  it('登録がない人は控除なしで作り、警告を結果とメモに残す', async () => {
    (loadConfig as any).mockResolvedValue(withDeductions);
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    const out = await generateFixedDrafts({ today: OCT_END });
    expect(itemsOf().every(i => i.kind === 'earning')).toBe(true);
    expect(out[0].deductions).toBe(0);
    expect(out[0].warnings?.[0]).toContain('登録');
    expect(db.payslips.create.mock.calls[0][0].data.note).toContain('⚠');
  });

  it('準業務委託には控除を付けない（給与ではない）。社員には付ける', async () => {
    (loadConfig as any).mockResolvedValue(withDeductions);
    const quasi = { ...plan, id: 'p2', user_id: 'u2', user: { id: 'u2', name: '佐藤', worker_type: 'quasi_contractor', withholding_class: 'ko' } };
    db.fixed_pay_plans.findMany.mockResolvedValue([quasi]);
    db.payroll_profiles.findMany.mockResolvedValue([{ ...profile, user_id: 'u2' }]);
    const out = await generateFixedDrafts({ today: OCT_END });
    expect(itemsOf().every(i => i.kind === 'earning')).toBe(true);
    expect(out[0].deductions).toBeUndefined();
    db.payslips.create.mockClear();
    const emp = { ...plan, id: 'p3', user_id: 'u3', label: '給与', amount: 300000, commute_amount: 12000, user: { id: 'u3', name: '鈴木', worker_type: 'employee', withholding_class: 'ko' } };
    db.fixed_pay_plans.findMany.mockResolvedValue([emp]);
    db.payroll_profiles.findMany.mockResolvedValue([{ ...profile, user_id: 'u3', standard_monthly: 300000 }]);
    await generateFixedDrafts({ today: OCT_END });
    expect(itemsOf().slice(0, 2).map(i => [i.label, i.amount])).toEqual([['給与', 300000], ['通勤手当', 12000]]);
    expect(deductionsOf()['健康保険料']).toBe(14775);
  });

  it('乙欄の人は「所得税（乙欄）」', async () => {
    (loadConfig as any).mockResolvedValue(withDeductions);
    db.fixed_pay_plans.findMany.mockResolvedValue([{ ...plan, user: { ...plan.user, withholding_class: 'otsu' } }]);
    db.payroll_profiles.findMany.mockResolvedValue([profile]);
    await generateFixedDrafts({ today: OCT_END });
    expect(Object.keys(deductionsOf())).toContain('所得税（乙欄）');
    expect(Object.keys(deductionsOf())).not.toContain('所得税（甲欄）');
  });

  it('プレビュー(dry)でも控除の合計と警告が見える。何も作らない', async () => {
    (loadConfig as any).mockResolvedValue(withDeductions);
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    db.payroll_profiles.findMany.mockResolvedValue([profile]);
    const out = await generateFixedDrafts({ today: OCT_END, dry: true });
    expect(out[0].deductions).toBeGreaterThan(0);
    expect(db.payslips.create).not.toHaveBeenCalled();
  });

  describe('再計算', () => {
    const slip = (over: object = {}) => ({
      id: 'slip1', user_id: 'u1', pay_month: '2026-10', status: 'planned', batch_id: null, auto_key: 'fixed:u1:2026-10', auto_edited: true, note: '下書きです\n\n【自動計算】\n・古い', pay_date: new Date('2026-11-25T00:00:00Z'),
      items: [
        { kind: 'earning', label: '役員報酬', amount: 500000, sort: 0, system_key: null },
        { kind: 'deduction', label: '健康保険料', amount: 1, sort: 100, system_key: null },
        { kind: 'deduction', label: '財形貯蓄', amount: 10000, sort: 3, system_key: null },
        { kind: 'earning', label: '立替金精算（1件）', amount: 3000, sort: 1000, system_key: 'expense_reimbursement' },
      ],
      user: { worker_type: 'executive', withholding_class: 'ko' }, ...over,
    });
    beforeEach(() => {
      (loadConfig as any).mockResolvedValue(withDeductions);
      db.payroll_profiles.findMany.mockResolvedValue([profile]);
    });

    it('自動の名前の控除の行だけ置き換え、経理が足した控除（財形貯蓄）と立替金は残す。メモの【自動計算】も書き換える', async () => {
      db.payslips.findUnique.mockResolvedValue(slip());
      const res = await recalc(json({ payslip_id: 'slip1' }));
      expect(res.status).toBe(200);
      const del = db.payslip_items.deleteMany.mock.calls[0][0].where;
      expect(del).toMatchObject({ payslip_id: 'slip1', kind: 'deduction', system_key: null });
      expect(del.label.in).toContain('健康保険料');
      expect(del.label.in).not.toContain('財形貯蓄');
      const created = db.payslip_items.createMany.mock.calls[0][0].data as { label: string; sort: number }[];
      expect(created.find(i => i.label === '健康保険料')).toBeTruthy();
      expect(created.every(i => i.sort >= 100)).toBe(true);
      const note = db.payslips.update.mock.calls[0][0].data.note as string;
      expect(note.startsWith('下書きです')).toBe(true);
      expect(note).not.toContain('古い');
      expect(note).toContain('2026-10分');
      expect((logAudit as any).mock.calls.at(-1)[0].actionType).toBe('payslip_deductions_recalc');
    });
    it('立替金の行は、支給の合計に入れない（給与ではない）', async () => {
      db.payslips.findUnique.mockResolvedValue(slip());
      await recalc(json({ payslip_id: 'slip1' }));
      expect(db.payslips.update.mock.calls[0][0].data.note).toContain('500,000円');
      expect(db.payslips.update.mock.calls[0][0].data.note).not.toContain('503,000円');
    });
    it('自動で作った下書きでなければ 400、全銀に入っていれば 409、OFF なら 400、なければ 404', async () => {
      db.payslips.findUnique.mockResolvedValue(slip({ auto_key: null }));
      expect((await recalc(json({ payslip_id: 'slip1' }))).status).toBe(400);
      db.payslips.findUnique.mockResolvedValue(slip({ batch_id: 'b1' }));
      expect((await recalc(json({ payslip_id: 'slip1' }))).status).toBe(409);
      db.payslips.findUnique.mockResolvedValue(slip({ status: 'paid' }));
      expect((await recalc(json({ payslip_id: 'slip1' }))).status).toBe(409);
      (loadConfig as any).mockResolvedValue(DEFAULT_CONFIG);
      db.payslips.findUnique.mockResolvedValue(slip());
      expect((await recalc(json({ payslip_id: 'slip1' }))).status).toBe(400);
      db.payslips.findUnique.mockResolvedValue(null);
      expect((await recalc(json({ payslip_id: 'slip1' }))).status).toBe(404);
      expect(db.payslip_items.deleteMany).not.toHaveBeenCalled();
    });
    it('経理・管理者以外は 403', async () => {
      (financeActor as any).mockResolvedValue(null);
      expect((await recalc(json({ payslip_id: 'slip1' }))).status).toBe(403);
      expect((await estimate(json({}))).status).toBe(403);
      expect((await putProfile(json({}, 'PUT'), { params: Promise.resolve({ userId: 'u1' }) })).status).toBe(403);
    });
  });

  describe('試算', () => {
    it('OFFでも試算できる。固定報酬から控除を出す', async () => {
      db.users.findUnique.mockResolvedValue({ worker_type: 'executive', withholding_class: 'ko', payroll_profile: profile });
      db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
      const body = await (await estimate(json({ user_id: 'u1', month: '2026-10' }))).json();
      expect(body.enabled).toBe(false);
      expect(body.earnings_total).toBe(500000);
      expect(body.lines.find((l: any) => l.key === 'health').amount).toBe(24625);
      expect(body.net).toBe(500000 - body.deductions);
    });
    it('金額を渡せば、固定報酬がなくても試算できる', async () => {
      db.users.findUnique.mockResolvedValue({ worker_type: 'employee', withholding_class: 'ko', payroll_profile: { ...profile, standard_monthly: 300000 } });
      const body = await (await estimate(json({ user_id: 'u1', month: '2026-10', earnings_total: 330000, nontaxable: 30000 }))).json();
      expect(body.earnings_total).toBe(330000);
      expect(body.nontaxable).toBe(30000);
      expect(body.lines.find((l: any) => l.key === 'employment').amount).toBe(1650);
    });
    it('対象でない区分・登録なし・固定報酬なしは、警告つきで返す', async () => {
      db.users.findUnique.mockResolvedValue({ worker_type: 'dispatch', withholding_class: 'ko', payroll_profile: null });
      expect((await (await estimate(json({ user_id: 'u1', month: '2026-10', earnings_total: 300000 }))).json()).warnings[0]).toContain('対象ではありません');
      db.users.findUnique.mockResolvedValue({ worker_type: 'executive', withholding_class: 'ko', payroll_profile: null });
      expect((await (await estimate(json({ user_id: 'u1', month: '2026-10', earnings_total: 300000 }))).json()).warnings[0]).toContain('登録');
      db.fixed_pay_plans.findMany.mockResolvedValue([]);
      expect((await (await estimate(json({ user_id: 'u1', month: '2026-10' }))).json()).warnings[0]).toContain('固定報酬がありません');
    });
    it('人がいなければ 404、月が不正なら 400', async () => {
      db.users.findUnique.mockResolvedValue(null);
      expect((await estimate(json({ user_id: 'x', month: '2026-10' }))).status).toBe(404);
      expect((await estimate(json({ user_id: 'x', month: '2026-13' }))).status).toBe(400);
    });
  });

  describe('一人ひとりの登録', () => {
    const ctxU = (userId: string) => ({ params: Promise.resolve({ userId }) });
    const body = { birth_date: '1975-03-20', health_insured: true, employment_insured: true, standard_monthly: 500000, dependents: 1, resident_tax: 30000, resident_tax_first: 31000 };
    it('保存でき、監査ログには変えた項目の名前だけを残す（生年月日の値は残さない）', async () => {
      db.users.findUnique.mockResolvedValue({ worker_type: 'employee', locked_at: null });
      db.payroll_profiles.findUnique.mockResolvedValue({ ...profile, dependents: 0, resident_tax: 30000, resident_tax_first: 31000, birth_date: new Date('1975-03-20T00:00:00Z') });
      db.payroll_profiles.upsert.mockResolvedValue({});
      const res = await putProfile(json({ ...body, withholding_class: 'otsu' }, 'PUT'), ctxU('u1'));
      expect(res.status).toBe(200);
      expect(db.payroll_profiles.upsert.mock.calls[0][0].create).toMatchObject({ user_id: 'u1', dependents: 1, updated_by_id: 'fin1' });
      expect(db.users.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { withholding_class: 'otsu' } });
      const meta = (logAudit as any).mock.calls.at(-1)[0].metadata;
      expect(meta.changed).toEqual(['dependents']);
      expect(JSON.stringify(meta)).not.toContain('1975');
    });
    it('派遣・業務委託は登録できない。未来の生年月日や、範囲外の扶養の数は 400。ロック済みは 404', async () => {
      db.users.findUnique.mockResolvedValue({ worker_type: 'dispatch', locked_at: null });
      expect((await putProfile(json(body, 'PUT'), ctxU('u1'))).status).toBe(400);
      db.users.findUnique.mockResolvedValue({ worker_type: 'employee', locked_at: null });
      expect((await putProfile(json({ ...body, birth_date: '2999-01-01' }, 'PUT'), ctxU('u1'))).status).toBe(400);
      expect((await putProfile(json({ ...body, dependents: 21 }, 'PUT'), ctxU('u1'))).status).toBe(400);
      expect((await putProfile(json({ ...body, resident_tax: -1 }, 'PUT'), ctxU('u1'))).status).toBe(400);
      db.users.findUnique.mockResolvedValue({ worker_type: 'employee', locked_at: new Date() });
      expect((await putProfile(json(body, 'PUT'), ctxU('u1'))).status).toBe(404);
      expect(db.payroll_profiles.upsert).not.toHaveBeenCalled();
    });
  });
});
