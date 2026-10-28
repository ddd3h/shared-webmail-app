// 固定の月額から、給与明細（支払予定）の下書きを作る。同じ人・同じ月の下書きは auto_key (unique) で一度だけ。
// 「控除の自動計算」がONなら、社会保険料・雇用保険料・源泉所得税・住民税の行も入れる。
// すでに全銀ファイルに入った明細（batch_id あり）は、金額が変わらないよう、決して触らない。
import { prisma } from '@/lib/db';
import { closingDate, DEFAULT_SCHEDULES, payDate } from '@/lib/pay-schedule';
import { loadSchedules } from '@/lib/pay-schedule-server';
import { isBonusTitle, toDbDate, type WorkerType } from '@/lib/work';
import { autoNoteSection, bonusKey, COMMUTE_LABEL, commuteTotal, deductionItems, DEDUCTION_SORT, draftPeriod, earningItems, earningTotal, fixedKey, isPlanDue, withAutoNote, type DraftItem } from '@/lib/fixed-pay';
import type { AutoflowConfig } from '@/lib/autoflow/config';
import { loadConfig } from '@/lib/autoflow/config-server';
import { REPLACEABLE_LABELS, type DeductionCompany, type DeductionResult } from '@/lib/payroll/deductions';
import { deductionsFor, type ProfileRow } from '@/lib/payroll/for-payslip';

export type DraftResult = {
  user_id: string; user_name: string; month: string; label: string; amount: number;
  // conflict: その月の明細を手ですでに入れてある（二重に払わないよう作らない）／skipped: 一度作った下書きが消されている（毎日の実行では作り直さない）
  status: 'new' | 'exists' | 'conflict' | 'skipped';
  // 控除の自動計算が働いたとき（status が new のときだけ）: 控除の合計と、警告（登録がない・率がない など）
  deductions?: number;
  warnings?: string[];
};

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const NOTE = 'オートフローが、登録された固定報酬から自動で作った下書きです。控除（源泉所得税など）を確認してから振込に進んでください。';
const NOTE_WITH_DEDUCTIONS = 'オートフローが、登録された固定報酬から自動で作った下書きです。控除は自動計算した概算です。確認してから振込に進んでください。';

// 「この人のこの月の下書きは、もう作った」という記録。経理が下書きを消して、その月は払わないことにしても、次の日にまた作らないための印。
// autoflow_notices の unique をそのまま使う（送信履歴には出さない: notices API が rule='fixed' を除く）。
const CLAIM = { rule: 'fixed', stage: 'draft' } as const;

const companyOf = (c: AutoflowConfig): DeductionCompany => ({ prefecture: c.deductions.prefecture, timing: c.deductions.timing });
const dayOf = (d: Date) => d.toISOString().slice(0, 10); // a @db.Date is stored as UTC midnight
const sum = (lines: { amount: number }[]) => lines.reduce((s, l) => s + l.amount, 0);

async function profilesOf(userIds: string[]): Promise<Map<string, ProfileRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.payroll_profiles.findMany({ where: { user_id: { in: userIds } } });
  return new Map(rows.map(r => [r.user_id, r]));
}

/** 下書きの控除。ONでない・対象でない区分なら null。 */
function draftDeductions(config: AutoflowConfig, user: { worker_type: string; withholding_class: string }, profile: ProfileRow | undefined, pay: string, closing: string, earnings: DraftItem[]): DeductionResult | null {
  if (!config.deductions.enabled) return null;
  return deductionsFor(companyOf(config), user, profile, pay, closing, earnings);
}

/**
 * 有効な固定報酬ごとに、今日作るべき月の下書きを作る。`month` を指定すると、その月の分を作る（手動。経理が押したときは、消した下書きも作り直せる）。
 * 何度呼んでも、同じ月の下書きは増えない。`dry` なら作らずに、結果だけ返す。
 */
export async function generateFixedDrafts(opts: { today: string; month?: string; actorId?: string | null; dry?: boolean; config?: AutoflowConfig }): Promise<DraftResult[]> {
  const [{ schedules }, plans, config] = await Promise.all([
    loadSchedules(),
    prisma.fixed_pay_plans.findMany({ where: { active: true, user: { locked_at: null } }, include: { user: { select: { id: true, name: true, worker_type: true, withholding_class: true } } }, orderBy: { created_at: 'asc' } }),
    opts.config ? Promise.resolve(opts.config) : loadConfig(),
  ]);
  const profiles = config.deductions.enabled ? await profilesOf([...new Set(plans.map(p => p.user_id))]) : new Map<string, ProfileRow>();
  const out: DraftResult[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    const type = plan.user.worker_type as WorkerType;
    const schedule = schedules[type] ?? DEFAULT_SCHEDULES.employee;
    const month = opts.month ?? draftPeriod(opts.today, schedule);
    if (!isPlanDue(plan, month)) continue;
    const key = fixedKey(plan.user_id, month);
    if (seen.has(key)) continue; // 期間が重なる計画が2つあっても、1人1か月に1枚
    seen.add(key);
    const row = { user_id: plan.user_id, user_name: plan.user.name, month, label: plan.label, amount: plan.amount };

    if (await prisma.payslips.findUnique({ where: { auto_key: key }, select: { id: true } })) { out.push({ ...row, status: 'exists' }); continue; }
    const manual = await prisma.payslips.findFirst({
      where: { user_id: plan.user_id, pay_month: month, auto_key: null, NOT: [{ title: '立替金精算' }, { title: { contains: '賞与' } }] },
      select: { id: true },
    });
    if (manual) { out.push({ ...row, status: 'conflict' }); continue; }
    const manualRun = opts.month !== undefined;
    const claimed = await prisma.autoflow_notices.findFirst({ where: { ...CLAIM, subject_key: key, user_id: plan.user_id }, select: { id: true } });
    if (claimed && !manualRun) { out.push({ ...row, status: 'skipped' }); continue; }

    const addons = await prisma.pay_extras.findMany({ where: { user_id: plan.user_id, pay_month: month, kind: 'addon' }, orderBy: { created_at: 'asc' } });
    const pay = payDate(month, schedule);
    const earnings = earningItems(plan, addons);
    const ded = draftDeductions(config, plan.user, profiles.get(plan.user_id), pay, closingDate(month, schedule), earnings);
    const extra = ded ? { deductions: sum(ded.lines), warnings: ded.warnings } : {};
    if (opts.dry) { out.push({ ...row, status: 'new', ...extra }); continue; }

    // 先に「作った」印を取る（同時に2つの実行が来ても、作るのは1つ）。作れなかったら印を戻す。
    let claimId: string | null = claimed?.id ?? null;
    if (!claimId) {
      try {
        claimId = (await prisma.autoflow_notices.create({ data: { ...CLAIM, subject_key: key, user_id: plan.user_id, title: `${plan.label} ${month}分の下書き`, delivered: true } })).id;
      } catch (e) {
        if (!isUnique(e)) throw e;
        out.push({ ...row, status: 'exists' }); continue; // 別の実行が先に取った
      }
    }
    try {
      await prisma.payslips.create({
        data: {
          user_id: plan.user_id, pay_month: month, title: plan.label, status: 'planned', auto_key: key,
          note: withAutoNote(ded ? NOTE_WITH_DEDUCTIONS : NOTE, ded ? autoNoteSection(ded) : null),
          created_by_id: opts.actorId ?? null, pay_date: toDbDate(pay),
          items: { create: [...earnings, ...deductionItems(ded?.lines ?? [])] },
        },
      });
      out.push({ ...row, status: 'new', ...extra });
    } catch (e) {
      if (!claimed && claimId) await prisma.autoflow_notices.delete({ where: { id: claimId } }).catch(() => {}); // 作れなかったので、印を戻す
      if (!isUnique(e)) throw e;
      out.push({ ...row, status: 'exists' }); // 別の実行が先に作った
    }
  }
  return out;
}

export type Reflect =
  | 'done'     // 下書きを作り直して、加算を反映した
  | 'edited'   // 経理が明細を直したあとなので、触っていない（明細に直接足してもらう）
  | 'locked'   // 全銀ファイルに入った／支払済み
  | 'none';    // まだ下書きがない（下書きができるときに入る）

/**
 * その月の加算が増えた・減ったとき、まだ手を入れていない（経理が明細を直していない）、全銀ファイルにも入っていない下書きを、
 * 支給の行（固定の月額・通勤手当は今の下書きのまま）＋ 加算 ＋ 控除（自動計算がONなら）に作り直す。
 * 経理が明細を直したあとの下書きは、直した内容を消さないよう触らない（'edited'）。
 */
export async function rebuildPristine(userId: string, month: string, opts: { config?: AutoflowConfig } = {}): Promise<Reflect> {
  const slip = await prisma.payslips.findUnique({
    where: { auto_key: fixedKey(userId, month) },
    include: { items: { orderBy: { sort: 'asc' } }, user: { select: { worker_type: true, withholding_class: true } } },
  });
  if (!slip) return 'none';
  if (slip.status !== 'planned' || slip.batch_id) return 'locked';
  if (slip.auto_edited) return 'edited';
  const [config, { schedules }] = await Promise.all([opts.config ? Promise.resolve(opts.config) : loadConfig(), loadSchedules()]);
  const schedule = schedules[slip.user.worker_type as WorkerType] ?? DEFAULT_SCHEDULES.employee;
  const addons = await prisma.pay_extras.findMany({ where: { user_id: userId, pay_month: month, kind: 'addon' }, orderBy: { created_at: 'asc' } });
  // 固定の月額（sort 0）と通勤手当（sort 1）は今の下書きの行をそのまま使う。固定報酬を変えても、できた下書きの金額は変えない。
  const kept: DraftItem[] = slip.items.filter(i => i.kind === 'earning' && !i.system_key && i.sort < 10).map(i => ({ kind: 'earning', label: i.label, amount: i.amount, sort: i.sort, system_key: null }));
  const earnings = [...kept, ...earningItems({ label: '', amount: 0 }, addons).slice(1)];
  const pay = slip.pay_date ? dayOf(slip.pay_date) : payDate(month, schedule);
  const profile = config.deductions.enabled ? (await profilesOf([userId])).get(userId) : undefined;
  const ded = draftDeductions(config, slip.user, profile, pay, closingDate(month, schedule), earnings);
  await prisma.$transaction([
    prisma.payslip_items.deleteMany({ where: { payslip_id: slip.id, system_key: null } }), // 立替金精算の行（system_key あり）は残す
    prisma.payslip_items.createMany({ data: [...earnings, ...deductionItems(ded?.lines ?? [])].map(i => ({ ...i, payslip_id: slip.id })) }),
    prisma.payslips.update({ where: { id: slip.id }, data: { note: withAutoNote(slip.note, ded ? autoNoteSection(ded) : null) } }),
  ]);
  return 'done';
}

export type Recalc =
  | { status: 'done'; deductions: number; warnings: string[] }
  | { status: 'not_found' | 'not_fixed' | 'locked' | 'disabled' | 'not_target' };

/**
 * 明細の支給の行から、控除をもう一度計算する（「控除を再計算」ボタン）。
 * 名前が自動の控除の名前（健康保険料・所得税（甲欄）など。手で入れた「所得税」も）の行だけを置き換え、経理が足した別の控除の行はそのまま残す。
 * 支給の行を直したあとや、登録（扶養・標準報酬月額など）を変えたあとに使う。
 */
export async function recalcDeductions(payslipId: string, opts: { config?: AutoflowConfig } = {}): Promise<Recalc> {
  const slip = await prisma.payslips.findUnique({
    where: { id: payslipId },
    include: { items: { orderBy: { sort: 'asc' } }, user: { select: { worker_type: true, withholding_class: true } } },
  });
  if (!slip) return { status: 'not_found' };
  if (!slip.auto_key?.startsWith('fixed:')) return { status: 'not_fixed' };
  if (slip.status !== 'planned' || slip.batch_id) return { status: 'locked' };
  const [config, { schedules }] = await Promise.all([opts.config ? Promise.resolve(opts.config) : loadConfig(), loadSchedules()]);
  if (!config.deductions.enabled) return { status: 'disabled' };
  const schedule = schedules[slip.user.worker_type as WorkerType] ?? DEFAULT_SCHEDULES.employee;
  const profile = (await profilesOf([slip.user_id])).get(slip.user_id);
  const pay = slip.pay_date ? dayOf(slip.pay_date) : payDate(slip.pay_month, schedule);
  const ded = deductionsFor(companyOf(config), slip.user, profile, pay, closingDate(slip.pay_month, schedule), slip.items);
  if (!ded) return { status: 'not_target' };
  const manual = slip.items.filter(i => !i.system_key && !(i.kind === 'deduction' && REPLACEABLE_LABELS.includes(i.label)));
  const from = Math.max(DEDUCTION_SORT - 1, ...manual.map(i => i.sort)) + 1;
  await prisma.$transaction([
    prisma.payslip_items.deleteMany({ where: { payslip_id: slip.id, kind: 'deduction', system_key: null, label: { in: REPLACEABLE_LABELS } } }),
    ...(ded.lines.length > 0 ? [prisma.payslip_items.createMany({ data: deductionItems(ded.lines, from).map(i => ({ ...i, payslip_id: slip.id })) })] : []),
    prisma.payslips.update({ where: { id: slip.id }, data: { note: withAutoNote(slip.note, autoNoteSection(ded)) } }),
  ]);
  return { status: 'done', deductions: sum(ded.lines), warnings: ded.warnings };
}

export type Estimate = {
  month: string; pay_date: string; earnings_total: number; nontaxable: number;
  lines: DeductionResult['lines']; notes: string[]; warnings: string[]; deductions: number; net: number; enabled: boolean;
};

/**
 * 明細を作らずに、控除を試算する。金額を渡さなければ、その月の固定報酬・通勤手当・加算から。
 * 「控除の自動計算」がOFFでも試算できる（ONにする前に確かめるため）。
 */
export async function estimateDeductions(userId: string, month: string, over: { earnings_total?: number; nontaxable?: number } = {}): Promise<Estimate | null> {
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { worker_type: true, withholding_class: true, payroll_profile: true } });
  if (!user) return null;
  const [{ schedules }, config] = await Promise.all([loadSchedules(), loadConfig()]);
  const schedule = schedules[user.worker_type as WorkerType] ?? DEFAULT_SCHEDULES.employee;
  const pay = payDate(month, schedule);
  let earnings: DraftItem[];
  if (over.earnings_total !== undefined) {
    const commute = Math.min(over.nontaxable ?? 0, over.earnings_total);
    earnings = [{ kind: 'earning', label: '支給', amount: over.earnings_total - commute, sort: 0, system_key: null }, ...(commute > 0 ? [{ kind: 'earning' as const, label: COMMUTE_LABEL, amount: commute, sort: 1, system_key: null }] : [])];
  } else {
    const plan = (await prisma.fixed_pay_plans.findMany({ where: { user_id: userId, active: true } })).find(p => isPlanDue(p, month));
    const addons = plan ? await prisma.pay_extras.findMany({ where: { user_id: userId, pay_month: month, kind: 'addon' }, orderBy: { created_at: 'asc' } }) : [];
    earnings = plan ? earningItems(plan, addons) : [];
  }
  const result = deductionsFor(companyOf(config), user, user.payroll_profile, pay, closingDate(month, schedule), earnings) ?? { lines: [], notes: [], warnings: ['この区分（派遣・業務委託・準業務委託）は、控除を自動で引く対象ではありません'] };
  if (earnings.length === 0) result.warnings.unshift(`${month}分に有効な固定報酬がありません。金額を入れて試算してください`);
  const total = earningTotal(earnings);
  const deductions = sum(result.lines);
  return { month, pay_date: pay, earnings_total: total, nontaxable: commuteTotal(earnings), ...result, deductions, net: total - deductions, enabled: config.deductions.enabled };
}

/** 賞与は、登録したらすぐ、別の給与明細（支払予定）になる。「賞与」を含む題名なので、「振込」の月次まとめに「賞与」として出る。 */
export async function createBonusSlip(extra: { id: string; user_id: string; pay_month: string; label: string; amount: number }, actorId: string | null): Promise<string> {
  const user = await prisma.users.findUnique({ where: { id: extra.user_id }, select: { worker_type: true } });
  const { schedules } = await loadSchedules();
  const schedule = schedules[(user?.worker_type ?? 'employee') as WorkerType] ?? DEFAULT_SCHEDULES.employee;
  const title = isBonusTitle(extra.label) ? extra.label : `賞与（${extra.label}）`; // 題名に「賞与」があると、月次まとめで「賞与」と呼ばれ、経費の立替金も合算されない
  const slip = await prisma.payslips.create({
    data: {
      user_id: extra.user_id, pay_month: extra.pay_month, title, status: 'planned', auto_key: bonusKey(extra.id), created_by_id: actorId,
      pay_date: toDbDate(payDate(extra.pay_month, schedule)), note: '賞与として登録された支払いです。控除（源泉所得税など）は自動では入りません。確認してから振込に進んでください。',
      items: { create: [{ kind: 'earning', label: extra.label, amount: extra.amount, sort: 0 }] },
    },
    select: { id: true },
  });
  return slip.id;
}

/** 賞与の登録を取り消す。まだ全銀ファイルに入っていない（支払予定の）明細だけ消せる。 */
export async function removeBonusSlip(extraId: string): Promise<'removed' | 'locked'> {
  const slip = await prisma.payslips.findUnique({ where: { auto_key: bonusKey(extraId) }, select: { id: true, status: true, batch_id: true } });
  if (!slip) return 'removed';
  if (slip.status !== 'planned' || slip.batch_id) return 'locked';
  await prisma.payslips.delete({ where: { id: slip.id } });
  return 'removed';
}
