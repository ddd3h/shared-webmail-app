'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import FoldCard from '@/components/mobile/FoldCard';
import { Notice, api, btn, btnPrimary, inp } from '@/components/work/ui';
import {
  DISABILITIES, DISABILITY_LABEL, MAX_DEPENDENTS, RELATIONS, RELATION_LABEL, SINGLE_STATUSES, SINGLE_STATUS_LABEL, STATUS_LABEL,
  blankDependent, blankPerson, blankYearEnd, dependentHint, spouseHint,
  type Dependent, type Disability, type Person, type YearEndData, type YearEndStatus,
} from '@/lib/year-end';

type Loaded = { applicable: true; years: number[]; default_year: number; year: number; status: YearEndStatus | 'none'; data: YearEndData };
const FIELD_LABEL: Record<string, string> = { name: '氏名', birth_date: '生年月日', income_estimate: '所得の見込み', company: '前職の会社名' };
const STATUS_STYLE: Record<string, string> = { none: 'bg-gray-100 text-gray-600', draft: 'bg-amber-50 text-amber-700', submitted: 'bg-blue-50 text-blue-700', confirmed: 'bg-emerald-50 text-emerald-700' };

// A whole-yen amount typed as digits; empty = not entered.
function Yen({ id, label, value, onChange, help }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; help?: string }) {
  return (
    <div>
      <label className="text-xs text-gray-600" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-1">
        <input id={id} className={inp} inputMode="numeric" autoComplete="off" value={value === null ? '' : String(value)}
          onChange={e => { const t = e.target.value.replace(/[^\d]/g, '').slice(0, 9); onChange(t === '' ? null : Number(t)); }} />
        <span className="shrink-0 text-xs text-gray-500">円</span>
      </div>
      {help && <p className="mt-0.5 text-xs text-gray-400">{help}</p>}
    </div>
  );
}

function Pick<T extends string>({ id, label, value, options, labels, onChange }: { id: string; label: string; value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-600" htmlFor={id}>{label}</label>
      <select id={id} className={inp} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(o => <option key={o} value={o}>{labels[o]}</option>)}</select>
    </div>
  );
}

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-gray-700">
      <input id={id} type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={checked} onChange={e => onChange(e.target.checked)} />{label}
    </label>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <fieldset className="space-y-3 rounded-xl border border-gray-200 p-3">
    <legend className="px-1 text-sm font-semibold text-gray-800">{title}</legend>
    {children}
  </fieldset>
);

// The fields shared by the spouse and every dependant.
function PersonFields({ p, set, id, hint }: { p: Person; set: (p: Person) => void; id: string; hint: string }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="text-xs text-gray-600" htmlFor={`${id}-name`}>氏名</label><input id={`${id}-name`} className={inp} maxLength={60} value={p.name} onChange={e => set({ ...p, name: e.target.value })} /></div>
        <div><label className="text-xs text-gray-600" htmlFor={`${id}-birth`}>生年月日</label><input id={`${id}-birth`} type="date" className={inp} value={p.birth_date} onChange={e => set({ ...p, birth_date: e.target.value })} /></div>
        <Yen id={`${id}-income`} label="今年の所得の見込み（合計所得金額）" value={p.income_estimate} onChange={v => set({ ...p, income_estimate: v })} help="給与だけなら、給与収入から給与所得控除を引いた額です。収入が無ければ 0 を入れます" />
        <Pick id={`${id}-dis`} label="障害" value={p.disability} options={DISABILITIES} labels={DISABILITY_LABEL} onChange={(v: Disability) => set({ ...p, disability: v })} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Check id={`${id}-co`} label="同居している" checked={p.cohabiting} onChange={v => set({ ...p, cohabiting: v })} />
        <Check id={`${id}-nr`} label="国外に住んでいる" checked={p.non_resident} onChange={v => set({ ...p, non_resident: v })} />
      </div>
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">目安: {hint}</p>
    </div>
  );
}

// 年末調整 (year-end tax adjustment) as the person enters it in the profile: spouse, dependants, deductions, a previous job.
// Saved as a draft; "提出する" hands it to 経理・人事, who check it (組織 > 年末調整). The My Number is not asked for here.
export default function YearEndSection() {
  const [st, setSt] = useState<Loaded | null | false>(null); // false = not adjusted here
  const [year, setYear] = useState<number | null>(null);
  const [d, setD] = useState<YearEndData>(blankYearEnd());
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState<YearEndStatus | 'none'>('none');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const seq = useRef(0); // only the latest answer counts (an earlier, slower one must not wipe what has been typed since)
  const load = useCallback(async (y: number | null) => {
    const mine = ++seq.current;
    const res = await fetch(`/api/profile/year-end${y ? `?year=${y}` : ''}`).catch(() => null);
    const b = res && res.ok ? await res.json() : null;
    if (mine !== seq.current) return;
    if (!b) { setSt(false); return; }
    if (!b.applicable) { setSt(false); return; }
    setSt(b); setYear(b.year); setD(b.data); setSaved(JSON.stringify(b.data)); setStatus(b.status);
  }, []);
  useEffect(() => { load(null); }, [load]);

  if (st === false) return null; // contractors, dispatched workers: not adjusted by this company
  if (st === null) return <FoldCard id="year-end" title="年末調整" label="年末調整" className="card p-5"><p className="text-sm text-gray-400">読み込み中…</p></FoldCard>;

  const dirty = JSON.stringify(d) !== saved;
  const setDep = (i: number, p: Dependent) => setD({ ...d, dependents: d.dependents.map((x, j) => (j === i ? p : x)) });

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await api(`/api/profile/year-end?year=${year}`, 'PUT', d);
      if (res.ok) {
        const b = await res.json(); setD(b.data); setSaved(JSON.stringify(b.data)); setStatus(b.status);
        setMsg({ type: 'success', text: '下書きとして保存しました。内容がそろったら「提出する」を押してください' });
      } else setMsg({ type: 'error', text: '保存できませんでした。入力（日付・金額）を確認してください' });
    } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const res = await api(`/api/profile/year-end/submit?year=${year}`, 'POST');
      if (res.ok) { const b = await res.json(); setStatus(b.status); setMsg({ type: 'success', text: '提出しました。経理・人事が内容を確認します' }); }
      else {
        const e = await res.json().catch(() => ({}));
        if (e.error === 'incomplete') {
          const names = [...new Set((e.fields as string[]).map(f => FIELD_LABEL[f.split('.').pop() ?? ''] ?? f))];
          setMsg({ type: 'error', text: `家族の欄に未入力があります（${names.join('・')}）` });
        } else setMsg({ type: 'error', text: '提出できませんでした' });
      }
    } finally { setBusy(false); }
  }

  const spouseOn = d.spouse !== null;
  return (
    <FoldCard id="year-end" title="年末調整" label="年末調整" badge={STATUS_LABEL[status as YearEndStatus] ?? '未入力'} className="card p-5" bodyClass="space-y-4">
      <p className="text-xs text-gray-500">年末調整に使う、配偶者・扶養親族・各種控除を入力します。本人・経理担当・人事担当・システム管理者だけが見られます。マイナンバーは、ここでは入力しません（別の方法で提出してください）。</p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700" htmlFor="year-end-year">対象の年</label>
          <select id="year-end-year" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={year ?? ''} disabled={busy}
            onChange={e => { if (!dirty || confirm('保存していない変更は消えます。年を切り替えますか？')) load(Number(e.target.value)); }}>
            {st.years.map(y => <option key={y} value={y}>{y}年分</option>)}
          </select>
        </div>
        <span data-testid="year-end-status" className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status as YearEndStatus] ?? '未入力'}</span>
        {status === 'submitted' && <span className="text-xs text-gray-500">確認を待っています。直すと下書きに戻ります</span>}
        {status === 'confirmed' && <span className="text-xs text-gray-500">経理・人事が確認しました。直すと、もう一度確認が必要です</span>}
      </div>

      <Group title="本人">
        <div className="grid gap-3 sm:grid-cols-2">
          <Pick id="ye-single" label="寡婦・ひとり親" value={d.self.single_status} options={SINGLE_STATUSES} labels={SINGLE_STATUS_LABEL} onChange={v => setD({ ...d, self: { ...d.self, single_status: v } })} />
          <Pick id="ye-self-dis" label="本人の障害" value={d.self.disability} options={DISABILITIES} labels={DISABILITY_LABEL} onChange={v => setD({ ...d, self: { ...d.self, disability: v } })} />
        </div>
        <Check id="ye-student" label="勤労学生である" checked={d.self.working_student} onChange={v => setD({ ...d, self: { ...d.self, working_student: v } })} />
      </Group>

      <Group title="配偶者">
        <Check id="ye-spouse" label="配偶者がいる" checked={spouseOn} onChange={v => setD({ ...d, spouse: v ? blankPerson() : null })} />
        {d.spouse && <PersonFields id="ye-sp" p={d.spouse} set={p => setD({ ...d, spouse: p })} hint={spouseHint(d.spouse)} />}
      </Group>

      <Group title={`扶養親族（${d.dependents.length}人）`}>
        {d.dependents.length === 0 && <p className="text-sm text-gray-400">扶養している家族がいれば追加してください（子・親など）</p>}
        {d.dependents.map((p, i) => (
          <div key={i} role="group" aria-label={`扶養親族 ${i + 1}`} className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
            <div className="flex items-end justify-between gap-3">
              <div className="w-40"><Pick id={`ye-dep${i}-rel`} label="続柄" value={p.relation} options={RELATIONS} labels={RELATION_LABEL} onChange={v => setDep(i, { ...p, relation: v })} /></div>
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setD({ ...d, dependents: d.dependents.filter((_, j) => j !== i) })}>この人を削除</button>
            </div>
            <PersonFields id={`ye-dep${i}`} p={p} set={q => setDep(i, { ...p, ...q })} hint={dependentHint(p, year ?? st.default_year)} />
          </div>
        ))}
        {d.dependents.length < MAX_DEPENDENTS && <button type="button" className={btn} onClick={() => setD({ ...d, dependents: [...d.dependents, blankDependent()] })}>＋ 扶養親族を追加</button>}
      </Group>

      <Group title="保険料・ローンなどの控除">
        <div className="grid gap-3 sm:grid-cols-2">
          <Yen id="ye-life" label="生命保険料（年間）" value={d.deductions.life_insurance} onChange={v => setD({ ...d, deductions: { ...d.deductions, life_insurance: v } })} help="保険会社の控除証明書の合計額" />
          <Yen id="ye-quake" label="地震保険料（年間）" value={d.deductions.earthquake_insurance} onChange={v => setD({ ...d, deductions: { ...d.deductions, earthquake_insurance: v } })} />
          <Yen id="ye-social" label="社会保険料（給与から引かれていない分）" value={d.deductions.social_insurance} onChange={v => setD({ ...d, deductions: { ...d.deductions, social_insurance: v } })} help="国民年金・国民健康保険など" />
          <Yen id="ye-mutual" label="小規模企業共済・iDeCoの掛金（年間）" value={d.deductions.small_business_mutual_aid} onChange={v => setD({ ...d, deductions: { ...d.deductions, small_business_mutual_aid: v } })} />
        </div>
        <Check id="ye-loan" label="住宅ローン控除を受ける（税務署への申告書は、別に提出してください）" checked={d.deductions.housing_loan} onChange={v => setD({ ...d, deductions: { ...d.deductions, housing_loan: v } })} />
      </Group>

      <Group title="今年、前の会社で働いていた分">
        <Check id="ye-prev" label="今年、他の会社から給与をもらっていた（中途入社）" checked={d.previous_job.has} onChange={v => setD({ ...d, previous_job: { ...d.previous_job, has: v } })} />
        {d.previous_job.has && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="text-xs text-gray-600" htmlFor="ye-prev-co">前の会社の名前</label><input id="ye-prev-co" className={inp} maxLength={100} value={d.previous_job.company} onChange={e => setD({ ...d, previous_job: { ...d.previous_job, company: e.target.value } })} /></div>
            <Yen id="ye-prev-inc" label="支払金額" value={d.previous_job.income} onChange={v => setD({ ...d, previous_job: { ...d.previous_job, income: v } })} help="前の会社の源泉徴収票の「支払金額」" />
            <Yen id="ye-prev-tax" label="源泉徴収税額" value={d.previous_job.tax_withheld} onChange={v => setD({ ...d, previous_job: { ...d.previous_job, tax_withheld: v } })} />
            <Yen id="ye-prev-soc" label="社会保険料等の金額" value={d.previous_job.social_insurance} onChange={v => setD({ ...d, previous_job: { ...d.previous_job, social_insurance: v } })} />
          </div>
        )}
      </Group>

      <div>
        <label className="text-xs text-gray-600" htmlFor="ye-note">備考（経理・人事へのメモ）</label>
        <textarea id="ye-note" className={inp} rows={2} maxLength={500} value={d.note} onChange={e => setD({ ...d, note: e.target.value })} />
      </div>

      <p className="text-xs text-gray-400">「目安」は、入力した内容から控除の対象になりそうかを示すものです。最終的な判断は、経理・人事が行います。</p>
      <Notice msg={msg} />
      <div className="flex flex-wrap justify-end gap-2">
        <button className={btn} disabled={busy || !dirty} onClick={save}>{busy ? '保存中…' : '下書きを保存'}</button>
        <button className={btnPrimary} disabled={busy || dirty || status !== 'draft'} onClick={submit} title={dirty ? '先に「下書きを保存」を押してください' : undefined}>提出する</button>
      </div>
    </FoldCard>
  );
}
