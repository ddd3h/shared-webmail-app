'use client';
import { dateLabel, inp, yen } from '@/components/work/ui';
import { KIND_LABEL, STATUS_LABEL, UNIT_LABEL, computeLines, linesTotal, tripDays, tripNights, type AllowanceType, type TripStatus } from '@/lib/trip';

export type Line = { id?: string; type_id: string | null; name: string; kind: 'daily' | 'addon'; unit: 'per_day' | 'per_night' | 'per_trip'; rate: number; quantity: number; amount: number };
export type TripExpense = { id: string; title: string; amount: number; payment_method: 'personal' | 'company'; status: string; expense_date: string };
export type Trip = {
  id: string; user: { id: string; name: string }; destination: string; purpose: string; start_date: string; end_date: string;
  days: number; nights: number; status: TripStatus; reviewer: string | null; review_comment: string | null;
  allowances: Line[]; allowance_total: number; expenses: TripExpense[]; expenses_total: number;
};
export type RateType = AllowanceType & { description: string | null; is_active: boolean; sort: number };

const STATUS_STYLE: Record<TripStatus, string> = {
  pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-600', cancelled: 'bg-gray-100 text-gray-500',
};
export const StatusBadge = ({ s }: { s: TripStatus }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STATUS_STYLE[s]}`}>{STATUS_LABEL[s]}</span>
);

export const periodLabel = (start: string, end: string) =>
  start === end ? dateLabel(start) : `${dateLabel(start)} 〜 ${dateLabel(end)}`;

export function TripHeader({ t, showUser }: { t: Trip; showUser?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <span>{periodLabel(t.start_date, t.end_date)}</span><span>{t.days}日{t.nights > 0 ? `（${t.nights}泊）` : '（日帰り）'}</span>
          {showUser && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">{t.user.name}</span>}
        </div>
        <div className="mt-0.5 text-sm font-medium text-gray-900 break-words">✈ {t.destination}</div>
      </div>
      <StatusBadge s={t.status} />
      <div className="text-right"><div className="text-[10px] text-gray-400">手当</div><div className="text-base font-bold tabular-nums">{yen(t.allowance_total)}</div></div>
    </div>
  );
}

// 日当・加算金 table (read-only)
export function LinesTable({ lines }: { lines: { name: string; kind: string; unit: string; rate: number; quantity: number; amount: number }[] }) {
  if (lines.length === 0) return <p className="text-xs text-gray-400">手当の指定はありません</p>;
  const unitWord = (u: string) => (u === 'per_day' ? '日' : u === 'per_night' ? '泊' : '回');
  return (
    <div className="rounded-lg border border-gray-100 text-sm">
      {lines.map((l, i) => (
        <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-100 last:border-0">
          <span className="min-w-0 break-words">{l.name}<span className="ml-2 text-[11px] text-gray-400">{yen(l.rate)} × {l.quantity}{unitWord(l.unit)}</span></span>
          <span className="tabular-nums whitespace-nowrap">{yen(l.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between bg-gray-50 px-3 py-1.5 font-bold"><span>手当合計</span><span className="tabular-nums">{yen(linesTotal(lines))}</span></div>
    </div>
  );
}

export function TripDetail({ t }: { t: Trip }) {
  return (
    <div className="space-y-3 text-sm">
      <div><div className="text-xs font-semibold text-gray-500 mb-0.5">業務内容</div><p className="whitespace-pre-wrap break-words text-gray-700">{t.purpose}</p></div>
      <div><div className="text-xs font-semibold text-gray-500 mb-1">日当・加算金</div><LinesTable lines={t.allowances} /></div>
      <div>
        <div className="text-xs font-semibold text-gray-500 mb-1">この出張の経費（{t.expenses.length}件）</div>
        {t.expenses.length === 0 ? <p className="text-xs text-gray-400">紐付いた経費はありません</p> : (
          <div className="rounded-lg border border-gray-100">
            {t.expenses.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-100 last:border-0">
                <span className="min-w-0 break-words text-xs">{e.expense_date.slice(5).replace('-', '/')} {e.title}<span className="ml-2 text-[11px] text-gray-400">{e.payment_method === 'personal' ? '立替' : '会社負担'}</span></span>
                <span className="tabular-nums whitespace-nowrap">{yen(e.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between bg-gray-50 px-3 py-1.5 font-bold"><span>経費合計</span><span className="tabular-nums">{yen(t.expenses_total)}</span></div>
          </div>
        )}
      </div>
      <div className="flex justify-between rounded-lg bg-blue-50 px-3 py-2 font-bold text-blue-900"><span>出張費の合計（手当＋経費）</span><span className="tabular-nums">{yen(t.allowance_total + t.expenses_total)}</span></div>
      {t.review_comment && (
        <p className={`rounded-lg px-3 py-2 text-xs ${t.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>{t.reviewer ?? '管理者'} のコメント: {t.review_comment}</p>
      )}
    </div>
  );
}

// Pick one 日当 and any number of 加算金; shows the calculation for the given dates as you click.
export function AllowancePicker({ types, daily, addons, start, end, onChange }: {
  types: RateType[]; daily: string; addons: string[]; start: string; end: string;
  onChange: (v: { daily: string; addons: string[] }) => void;
}) {
  const valid = !!start && !!end && end >= start;
  const chosen = types.filter(t => t.id === daily || addons.includes(t.id));
  const lines = valid ? computeLines(chosen, start, end) : [];
  const dailies = types.filter(t => t.kind === 'daily');
  const extras = types.filter(t => t.kind === 'addon');
  const toggle = (id: string) => onChange({ daily, addons: addons.includes(id) ? addons.filter(a => a !== id) : [...addons, id] });

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">日当</div>
        <div className="space-y-1.5">
          <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${daily === '' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
            <input type="radio" checked={daily === ''} onChange={() => onChange({ daily: '', addons })} />日当なし
          </label>
          {dailies.map(t => (
            <label key={t.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${daily === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <input type="radio" checked={daily === t.id} onChange={() => onChange({ daily: t.id, addons })} />
              <span className="flex-1">{t.name}{t.description && <span className="block text-[11px] text-gray-400">{t.description}</span>}</span>
              <span className="text-xs text-gray-500 whitespace-nowrap">{yen(t.amount)} / {UNIT_LABEL[t.unit].replace('あたり', '')}</span>
            </label>
          ))}
        </div>
      </div>
      {extras.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">業務内容による加算金（該当するものを選択）</div>
          <div className="space-y-1.5">
            {extras.map(t => (
              <label key={t.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${addons.includes(t.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <input type="checkbox" checked={addons.includes(t.id)} onChange={() => toggle(t.id)} />
                <span className="flex-1">{t.name}{t.description && <span className="block text-[11px] text-gray-400">{t.description}</span>}</span>
                <span className="text-xs text-gray-500 whitespace-nowrap">{yen(t.amount)} / {UNIT_LABEL[t.unit].replace('あたり', '')}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">計算結果{valid && `（${tripDays(start, end)}日・${tripNights(start, end)}泊）`}</div>
        {valid ? <LinesTable lines={lines} /> : <p className="text-xs text-gray-400">期間を入力すると計算されます</p>}
      </div>
    </div>
  );
}

export { inp, KIND_LABEL, UNIT_LABEL };
