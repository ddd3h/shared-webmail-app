'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Notice, PanelSkeleton, TYPE_LABEL, api, btn, btnPrimary, yen, type WorkerType } from '@/components/work/ui';
import {
  DISABILITY_LABEL, RELATION_LABEL, SINGLE_STATUS_LABEL, STATUS_LABEL, dependentHint, spouseHint,
  type Person, type YearEndData, type YearEndStatus,
} from '@/lib/year-end';

type Item = { user: { id: string; name: string; worker_type: string }; status: YearEndStatus | 'none'; data: YearEndData | null; submitted_at: string | null; confirmed_at: string | null; version: string | null };
const STYLE: Record<string, string> = { none: 'bg-gray-100 text-gray-600', draft: 'bg-amber-50 text-amber-700', submitted: 'bg-blue-50 text-blue-700', confirmed: 'bg-emerald-50 text-emerald-700' };
const label = (s: string) => (s === 'none' ? '未入力' : STATUS_LABEL[s as YearEndStatus]);
const amount = (n: number | null) => (n === null ? '—' : yen(n));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ja-JP') : '');

const Row = ({ k, v }: { k: string; v: string }) => <div><dt className="text-xs text-gray-500">{k}</dt><dd className="text-sm font-medium text-gray-900 wrap-break-word">{v}</dd></div>;

function PersonView({ title, p, hint }: { title: string; p: Person; hint: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
      <p className="text-sm font-semibold text-gray-900">{title}: {p.name || '（氏名なし）'}</p>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Row k="生年月日" v={p.birth_date || '—'} /><Row k="所得の見込み" v={amount(p.income_estimate)} />
        <Row k="同居" v={p.cohabiting ? '同居' : '別居'} /><Row k="障害・国外" v={[p.disability !== 'none' ? DISABILITY_LABEL[p.disability] : '', p.non_resident ? '国外居住' : ''].filter(Boolean).join('、') || 'なし'} />
      </dl>
      <p className="mt-2 text-xs text-gray-500">目安: {hint}</p>
    </div>
  );
}

function Detail({ d, year }: { d: YearEndData; year: number }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Row k="寡婦・ひとり親" v={SINGLE_STATUS_LABEL[d.self.single_status]} /><Row k="本人の障害" v={DISABILITY_LABEL[d.self.disability]} /><Row k="勤労学生" v={d.self.working_student ? 'はい' : 'いいえ'} />
      </dl>
      {d.spouse ? <PersonView title="配偶者" p={d.spouse} hint={spouseHint(d.spouse)} /> : <p className="text-sm text-gray-500">配偶者: なし</p>}
      {d.dependents.length === 0 ? <p className="text-sm text-gray-500">扶養親族: なし</p> : d.dependents.map((p, i) => <PersonView key={i} title={`扶養親族（${RELATION_LABEL[p.relation]}）`} p={p} hint={dependentHint({ ...p }, year)} />)}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Row k="生命保険料" v={amount(d.deductions.life_insurance)} /><Row k="地震保険料" v={amount(d.deductions.earthquake_insurance)} />
        <Row k="社会保険料（天引き以外）" v={amount(d.deductions.social_insurance)} /><Row k="小規模企業共済・iDeCo" v={amount(d.deductions.small_business_mutual_aid)} />
        <Row k="住宅ローン控除" v={d.deductions.housing_loan ? '受ける' : 'なし'} />
      </dl>
      {d.previous_job.has && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Row k="前の会社" v={d.previous_job.company || '—'} /><Row k="支払金額" v={amount(d.previous_job.income)} /><Row k="源泉徴収税額" v={amount(d.previous_job.tax_withheld)} /><Row k="社会保険料等" v={amount(d.previous_job.social_insurance)} />
        </dl>
      )}
      {d.note && <Row k="備考" v={d.note} />}
    </div>
  );
}

// 経理・人事: everybody's 年末調整 declarations for a year, who has not handed one in, the CSV, and "確認済みにする".
export default function YearEndPanel() {
  const [year, setYear] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const seq = useRef(0);
  const load = useCallback(async (y: number | null) => {
    const mine = ++seq.current;
    const res = await fetch(`/api/year-end${y ? `?year=${y}` : ''}`);
    if (mine !== seq.current) return;
    if (res.ok) { const b = await res.json(); setYear(b.year); setYears(b.years); setItems(b.items); }
    setLoaded(true);
  }, []);
  useEffect(() => { load(null); }, [load]);

  async function confirm(it: Item) {
    setMsg(null);
    const res = await api(`/api/year-end/${it.user.id}/confirm`, 'POST', { year, version: it.version });
    if (res.ok) { setMsg({ type: 'success', text: `${it.user.name}さんの分を確認済みにしました` }); load(year); }
    else {
      const e = await res.json().catch(() => ({}));
      setMsg({ type: 'error', text: e.error === 'changed' ? '本人が内容を直しました。もう一度確かめてください' : '確認済みにできませんでした' });
      load(year);
    }
  }

  const count = (s: string) => items.filter(i => i.status === s).length;
  return (
    <div className="space-y-4">
      <Notice msg={msg} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-700" htmlFor="ye-admin-year">対象の年</label>
        <select id="ye-admin-year" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={year ?? ''} onChange={e => { setLoaded(false); load(Number(e.target.value)); }}>
          {years.map(y => <option key={y} value={y}>{y}年分</option>)}
        </select>
        <a className={`${btn} ml-auto`} href={year ? `/api/year-end/export?year=${year}` : undefined} download>CSVでダウンロード</a>
      </div>
      <p className="text-xs text-gray-500">年末調整の申告は、家族の名前・生年月日・所得などを含みます。見るたび・ダウンロードするたびに、記録が残ります。マイナンバーは扱いません。</p>

      {!loaded && <PanelSkeleton cols={3} />}
      {loaded && (
        <div className="tab-fade space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="year-end-counts">
            {(['none', 'draft', 'submitted', 'confirmed'] as const).map(s => (
              <div key={s} className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{label(s)}</div><div className="text-lg font-semibold text-gray-900">{count(s)}<span className="text-xs font-normal text-gray-400">人</span></div></div>
            ))}
          </div>
          {items.length === 0 && <p className="text-sm text-gray-400">年末調整の対象（正社員・パート・従業員・役員）の人がいません</p>}
          {items.map(it => (
            <div key={it.user.id} className="rounded-xl border border-gray-200 bg-white">
              <button className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={open === it.user.id} disabled={!it.data} onClick={() => setOpen(open === it.user.id ? null : it.user.id)}>
                <div className="min-w-0 flex-1"><div className="truncate font-medium text-gray-900">{it.user.name}</div><div className="text-xs text-gray-500">{TYPE_LABEL[it.user.worker_type as WorkerType] ?? it.user.worker_type}{it.submitted_at ? `　提出 ${day(it.submitted_at)}` : ''}{it.confirmed_at ? `　確認 ${day(it.confirmed_at)}` : ''}</div></div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[it.status]}`}>{label(it.status)}</span>
              </button>
              {open === it.user.id && it.data && year && (
                <div className="space-y-3 border-t border-gray-100 p-3">
                  <Detail d={it.data} year={year} />
                  {it.status === 'submitted' && <div className="flex justify-end"><button className={btnPrimary} onClick={() => confirm(it)}>確認済みにする</button></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
