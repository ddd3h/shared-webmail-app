// 固定の月額から、給与明細（支払予定）の下書きを作る。同じ人・同じ月の下書きは auto_key (unique) で一度だけ。
// すでに全銀ファイルに入った明細（batch_id あり）は、金額が変わらないよう、決して触らない。
import { prisma } from '@/lib/db';
import { DEFAULT_SCHEDULES, payDate } from '@/lib/pay-schedule';
import { loadSchedules } from '@/lib/pay-schedule-server';
import { isBonusTitle, toDbDate, type WorkerType } from '@/lib/work';
import { ADDON_PREFIX, bonusKey, draftItems, draftPeriod, fixedKey, isPlanDue } from '@/lib/fixed-pay';

export type DraftResult = {
  user_id: string; user_name: string; month: string; label: string; amount: number;
  status: 'new' | 'exists' | 'conflict'; // conflict: その月の明細を手ですでに入れてある（二重に払わないよう作らない）
};

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const NOTE = 'オートフローが、登録された固定報酬から自動で作った下書きです。控除（源泉所得税など）を確認してから振込に進んでください。';

/**
 * 有効な固定報酬ごとに、今日作るべき月の下書きを作る。`month` を指定すると、その月の分を作る（手動）。
 * 何度呼んでも、同じ月の下書きは増えない。`dry` なら作らずに、結果だけ返す。
 */
export async function generateFixedDrafts(opts: { today: string; month?: string; actorId?: string | null; dry?: boolean }): Promise<DraftResult[]> {
  const [{ schedules }, plans] = await Promise.all([
    loadSchedules(),
    prisma.fixed_pay_plans.findMany({ where: { active: true, user: { locked_at: null } }, include: { user: { select: { id: true, name: true, worker_type: true } } }, orderBy: { created_at: 'asc' } }),
  ]);
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
    if (opts.dry) { out.push({ ...row, status: 'new' }); continue; }

    const addons = await prisma.pay_extras.findMany({ where: { user_id: plan.user_id, pay_month: month, kind: 'addon' }, orderBy: { created_at: 'asc' } });
    try {
      await prisma.payslips.create({
        data: {
          user_id: plan.user_id, pay_month: month, title: plan.label, status: 'planned', note: NOTE, auto_key: key,
          created_by_id: opts.actorId ?? null, pay_date: toDbDate(payDate(month, schedule)),
          items: { create: draftItems(plan, addons) },
        },
      });
      out.push({ ...row, status: 'new' });
    } catch (e) {
      if (!isUnique(e)) throw e;
      out.push({ ...row, status: 'exists' }); // 別の実行が先に作った
    }
  }
  return out;
}

/** その月の加算が増えた・減ったとき、まだ全銀ファイルに入っていない下書きの加算の行を作り直す。 */
export async function syncAddons(userId: string, month: string): Promise<void> {
  const slip = await prisma.payslips.findUnique({ where: { auto_key: fixedKey(userId, month) }, select: { id: true, status: true, batch_id: true } });
  if (!slip || slip.status !== 'planned' || slip.batch_id) return;
  const addons = await prisma.pay_extras.findMany({ where: { user_id: userId, pay_month: month, kind: 'addon' }, orderBy: { created_at: 'asc' } });
  const rows = draftItems({ label: '', amount: 0 }, addons).slice(1).map(i => ({ ...i, payslip_id: slip.id }));
  await prisma.$transaction([
    prisma.payslip_items.deleteMany({ where: { payslip_id: slip.id, system_key: { startsWith: ADDON_PREFIX } } }),
    ...(rows.length > 0 ? [prisma.payslip_items.createMany({ data: rows })] : []),
  ]);
}

/** 賞与は、登録したらすぐ、別の給与明細（支払予定）になる。「賞与」を含む題名なので、全銀の賞与の区分(12)で出せる。 */
export async function createBonusSlip(extra: { id: string; user_id: string; pay_month: string; label: string; amount: number }, actorId: string | null): Promise<string> {
  const user = await prisma.users.findUnique({ where: { id: extra.user_id }, select: { worker_type: true } });
  const { schedules } = await loadSchedules();
  const schedule = schedules[(user?.worker_type ?? 'employee') as WorkerType] ?? DEFAULT_SCHEDULES.employee;
  const title = isBonusTitle(extra.label) ? extra.label : `賞与（${extra.label}）`; // 題名に「賞与」があると、全銀の賞与の区分で出る
  const slip = await prisma.payslips.create({
    data: {
      user_id: extra.user_id, pay_month: extra.pay_month, title, status: 'planned', auto_key: bonusKey(extra.id), created_by_id: actorId,
      pay_date: toDbDate(payDate(extra.pay_month, schedule)), note: '賞与として登録された支払いです。控除（源泉所得税など）を確認してから振込に進んでください。',
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
