import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const store = new Map<string, string>();
vi.mock('@/lib/db', () => ({
  prisma: {
    users: { findMany: vi.fn() },
    work_reports: { findMany: vi.fn() },
    expense_claims: { findMany: vi.fn() },
    autoflow_notices: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    autoflow_runs: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    fixed_pay_plans: { findMany: vi.fn() },
    pay_extras: { findMany: vi.fn() },
    payslips: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('@/lib/settings', () => ({
  getSetting: vi.fn(async (k: string) => store.get(k) ?? null),
  setSetting: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
}));
vi.mock('@/lib/finance-guard', () => ({ financeActor: vi.fn(), forbidden: vi.fn(() => NextResponse.json({ error: 'forbidden' }, { status: 403 })) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/pay-schedule-server', async () => {
  const { DEFAULT_SCHEDULES } = await import('@/lib/pay-schedule');
  return { loadSchedules: vi.fn(async () => ({ schedules: DEFAULT_SCHEDULES, custom: new Set() })) };
});
vi.mock('@/lib/transfer-monthly', () => ({ loadMonthlyItems: vi.fn(async () => []) }));
vi.mock('@/lib/org-server', () => ({ approversOf: vi.fn(async () => []) }));
vi.mock('@/lib/mattermost-dm', async () => ({ ...(await vi.importActual<object>('@/lib/mattermost-dm')), sendDirectMessage: vi.fn() }));

import { GET as getConfig, PUT as putConfig } from '@/app/api/autoflow/config/route';
import { POST as run } from '@/app/api/autoflow/run/route';
import { GET as notices } from '@/app/api/autoflow/notices/route';
import { runAutoflow, runDaily } from '@/lib/autoflow/run';
import { prisma } from '@/lib/db';
import { financeActor } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';
import { sendDirectMessage } from '@/lib/mattermost-dm';

const db = prisma as any;
const req = (body?: unknown) => new NextRequest('http://localhost/api/autoflow/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const ON = JSON.stringify({ report: { enabled: true } });
const NOW = new Date('2026-10-30T01:00:00Z'); // 10/30 10:00 JST: 10月分の締め日(10/31)の前日

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  (financeActor as any).mockResolvedValue({ id: 'keiri' });
  // 準業務委託が1人。報告書なし
  db.users.findMany.mockImplementation(async (a: any) => (a?.where?.id ? [{ id: 'w1', name: '山田' }] : [{ id: 'w1', email: 'w1@example.com', name: '山田', worker_type: 'quasi_contractor', created_at: new Date('2026-01-01T00:00:00Z') }]));
  db.work_reports.findMany.mockResolvedValue([]);
  db.autoflow_notices.findMany.mockResolvedValue([]);
  db.autoflow_notices.create.mockResolvedValue({ id: 'n1' });
  db.autoflow_notices.update.mockResolvedValue({});
  db.autoflow_runs.create.mockResolvedValue({});
  db.autoflow_runs.update.mockResolvedValue({});
  (sendDirectMessage as any).mockResolvedValue(true);
  db.fixed_pay_plans.findMany.mockResolvedValue([]);
  db.pay_extras.findMany.mockResolvedValue([]);
  db.payslips.findUnique.mockResolvedValue(null);
  db.payslips.findFirst.mockResolvedValue(null);
  db.payslips.create.mockResolvedValue({ id: 'slip1' });
});

describe('オートフローの設定API', () => {
  it('経理・管理者以外は403', async () => {
    (financeActor as any).mockResolvedValue(null);
    expect((await getConfig()).status).toBe(403);
    expect((await putConfig(req({ config: {} }))).status).toBe(403);
    expect(store.size).toBe(0);
  });

  it('保存すると、そのまま読める。監査ログにも残る', async () => {
    const config = { report: { enabled: true }, expense: { enabled: true, days_before: 5 }, payment: { enabled: false, days_before: 3 }, confirm: { enabled: false }, fixed_pay: { enabled: false }, activity: { enabled: false, days: 14 } };
    const res = await putConfig(req({ config }));
    expect(res.status).toBe(200);
    expect((await (await getConfig()).json()).config).toEqual(config);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'keiri', actionType: 'autoflow_config_update' }));
  });

  it('範囲外の日数は400で、保存しない', async () => {
    expect((await putConfig(req({ config: { expense: { enabled: true, days_before: 99 } } }))).status).toBe(400);
    expect(store.size).toBe(0);
  });
});

describe('オートフローの実行', () => {
  it('何も ON でなければ何もしない', async () => {
    const r = await runAutoflow({ now: NOW });
    expect(r.planned).toBe(0);
    expect(sendDirectMessage).not.toHaveBeenCalled();
    expect(db.users.findMany).not.toHaveBeenCalled();
  });

  it('dry（確認だけ）は何も送らず、記録も作らない', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    const r = await runAutoflow({ now: NOW, dry: true });
    expect(r.planned).toBe(1);
    expect(r.items[0]).toMatchObject({ rule: 'report', stage: 'eve', user_name: '山田', already_sent: false });
    expect(sendDirectMessage).not.toHaveBeenCalled();
    expect(db.autoflow_notices.create).not.toHaveBeenCalled();
  });

  it('送る前に記録の枠を取り、DMを送り、届いたら delivered にする', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    const r = await runAutoflow({ now: NOW });
    expect(r).toMatchObject({ planned: 1, sent: 1, delivered: 1, skipped: 0 });
    expect(db.autoflow_notices.create).toHaveBeenCalledWith({ data: expect.objectContaining({ rule: 'report', stage: 'eve', subject_key: 'report:2026-10', user_id: 'w1' }) });
    expect(sendDirectMessage).toHaveBeenCalledWith('w1', 'w1@example.com', expect.stringContaining('締め日は明日'), 'work_report_reminder');
    expect(db.autoflow_notices.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { delivered: true } });
  });

  it('Mattermost に届かなくても（アプリ内だけでも）記録は残し、届いた扱いにはしない', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    (sendDirectMessage as any).mockResolvedValue(false);
    const r = await runAutoflow({ now: NOW });
    expect(r).toMatchObject({ sent: 1, delivered: 0 });
    expect(db.autoflow_notices.update).not.toHaveBeenCalled();
  });

  it('すでに送ったものは送らない（何度実行しても二重に届かない）', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    db.autoflow_notices.findMany.mockResolvedValue([{ rule: 'report', stage: 'eve', subject_key: 'report:2026-10', user_id: 'w1' }]);
    const r = await runAutoflow({ now: NOW });
    expect(r).toMatchObject({ planned: 1, sent: 0, skipped: 1 });
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });

  it('別の実行が先に枠を取っていたとき（unique 違反）は、送らずに飛ばす', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    db.autoflow_notices.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const r = await runAutoflow({ now: NOW });
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });
});

describe('1日1回の定期実行', () => {
  it('何も ON でなければ、今日の枠も取らない（あとで ON にしたらその日のうちに動く）', async () => {
    expect(await runDaily(NOW)).toBeNull();
    expect(db.autoflow_runs.create).not.toHaveBeenCalled();
  });

  it('今日の枠が取れたら動き、終わりを記録する', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    const r = await runDaily(NOW);
    expect(r?.sent).toBe(1);
    expect(db.autoflow_runs.create).toHaveBeenCalledWith({ data: { run_date: '2026-10-30' } });
    expect(db.autoflow_runs.update).toHaveBeenCalledWith({ where: { run_date: '2026-10-30' }, data: expect.objectContaining({ finished_at: expect.any(Date), summary: expect.stringContaining('"sent":1') }) });
  });

  it('今日はもう動いた（枠がある）なら、何もしない', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    db.autoflow_runs.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    db.autoflow_runs.findUnique.mockResolvedValue({ run_date: '2026-10-30', started_at: new Date(NOW.getTime() - 3600_000), finished_at: new Date(NOW.getTime() - 3500_000) });
    expect(await runDaily(NOW)).toBeNull();
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });

  it('動き始めたまま止まった枠（10分以上たって終わっていない）は取り直す', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    db.autoflow_runs.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    db.autoflow_runs.findUnique.mockResolvedValue({ run_date: '2026-10-30', started_at: new Date(NOW.getTime() - 11 * 60_000), finished_at: null });
    expect((await runDaily(NOW))?.sent).toBe(1);
  });

  it('動いている最中（10分以内）の枠には手を出さない', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    db.autoflow_runs.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    db.autoflow_runs.findUnique.mockResolvedValue({ run_date: '2026-10-30', started_at: new Date(NOW.getTime() - 60_000), finished_at: null });
    expect(await runDaily(NOW)).toBeNull();
  });
});

describe('固定報酬の下書き（オートフローの一部）', () => {
  const FIXED_ON = JSON.stringify({ fixed_pay: { enabled: true } });
  const plan = { id: 'p1', user_id: 'e1', label: '役員報酬', amount: 500000, starts_month: '2026-04', ends_month: null, active: true, user: { id: 'e1', name: '佐藤', worker_type: 'executive' } };
  const CLOSING = new Date('2026-10-31T01:00:00Z'); // 10/31 10:00 JST: 末締めの締め日

  it('固定報酬だけ ON でも「動く」（通知がなくても下書きは作る）', async () => {
    store.set('AUTOFLOW_CONFIG', FIXED_ON);
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    const r = await runAutoflow({ now: CLOSING });
    expect(r.drafts).toEqual([expect.objectContaining({ user_name: '佐藤', month: '2026-10', status: 'new' })]);
    expect(db.payslips.create).toHaveBeenCalledTimes(1);
  });

  it('プレビュー(dry)では、作らずに「作るはずのもの」だけ見せる', async () => {
    store.set('AUTOFLOW_CONFIG', FIXED_ON);
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    const r = await runAutoflow({ now: CLOSING, dry: true });
    expect(r.drafts[0].status).toBe('new');
    expect(db.payslips.create).not.toHaveBeenCalled();
  });

  it('OFF のときは、登録があっても下書きを作らない', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    const r = await runAutoflow({ now: CLOSING });
    expect(r.drafts).toEqual([]);
    expect(db.payslips.create).not.toHaveBeenCalled();
  });

  it('毎日の実行に入っていて、記録に作った件数が残る', async () => {
    store.set('AUTOFLOW_CONFIG', FIXED_ON);
    db.fixed_pay_plans.findMany.mockResolvedValue([plan]);
    await runDaily(CLOSING);
    const summary = JSON.parse(db.autoflow_runs.update.mock.calls[0][0].data.summary);
    expect(summary.drafts).toBe(1);
  });
});

describe('実行・履歴のAPI', () => {
  it('経理・管理者以外は403で、何も送らない', async () => {
    (financeActor as any).mockResolvedValue(null);
    expect((await run(req({ dry: false }))).status).toBe(403);
    expect((await notices()).status).toBe(403);
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });

  it('明示的に dry:false と言わない限り、確認だけで送らない', async () => {
    store.set('AUTOFLOW_CONFIG', ON);
    for (const body of [undefined, {}, { dry: true }, { dry: 'no' }]) {
      const res = await run(req(body));
      expect((await res.json()).dry).toBe(true);
    }
    expect(sendDirectMessage).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('履歴は新しい順で、宛先の名前つき', async () => {
    db.autoflow_notices.findMany.mockResolvedValue([{ id: 'n1', rule: 'report', stage: 'eve', user_id: 'w1', title: 't', delivered: false, created_at: new Date('2026-10-30T00:00:00Z') }]);
    const body = await (await notices()).json();
    expect(body.items).toEqual([{ id: 'n1', rule: 'report', stage: 'eve', title: 't', delivered: false, created_at: '2026-10-30T00:00:00.000Z', user_name: '山田' }]);
    expect(db.autoflow_notices.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { created_at: 'desc' } }));
  });
});
