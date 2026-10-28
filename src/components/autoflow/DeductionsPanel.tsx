'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, btn, btnPrimary, currentMonth, inp, Notice, TYPE_LABEL, yen, type WorkerType } from '@/components/work/ui';

type Profile = { birth_date: string | null; health_insured: boolean; employment_insured: boolean; standard_monthly: number | null; dependents: number; resident_tax: number; resident_tax_first: number | null };
type Person = { id: string; name: string; worker_type: string; withholding_class: 'ko' | 'otsu'; plan: { amount: number; commute_amount: number; starts_month: string; ends_month: string | null } | null; profile: Profile | null };
type Estimate = { month: string; pay_date: string; earnings_total: number; nontaxable: number; lines: { key: string; label: string; amount: number }[]; notes: string[]; warnings: string[]; deductions: number; net: number; enabled: boolean };
type Msg = { type: 'success' | 'error'; text: string } | null;

const ERR: Record<string, string> = {
  invalid_body: '入力を確かめてください（生年月日は過去の日付、扶養親族等の数は0〜20、金額は0以上の整数）',
  type_not_allowed: '役員・社員・正社員・パート・準業務委託の人だけ登録できます',
};
const blankForm = { birth_date: '', health_insured: true, employment_insured: true, standard_monthly: '', dependents: '0', resident_tax: '0', resident_tax_first: '', withholding_class: 'ko' as 'ko' | 'otsu' };

// 社会保険料・雇用保険料・源泉所得税・住民税を自動で計算するための、一人ひとりの登録（と、計算の試し）。
export default function DeductionsPanel() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const say = (m: Msg) => { setMsg(m); if (m) setTimeout(() => setMsg(null), 5000); };
  const load = useCallback(() => {
    fetch('/api/autoflow/profiles').then(r => r.json()).then(d => setPeople(d.people ?? [])).catch(() => setPeople([]));
    fetch('/api/autoflow/config').then(r => r.json()).then(d => setEnabled(!!d.config?.deductions?.enabled)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const [open, setOpen] = useState<{ id: string; mode: 'edit' | 'estimate' } | null>(null);
  const [form, setForm] = useState(blankForm);
  function startEdit(p: Person) {
    const x = p.profile;
    setForm(x ? { birth_date: x.birth_date ?? '', health_insured: x.health_insured, employment_insured: x.employment_insured, standard_monthly: x.standard_monthly === null ? '' : String(x.standard_monthly), dependents: String(x.dependents), resident_tax: String(x.resident_tax), resident_tax_first: x.resident_tax_first === null ? '' : String(x.resident_tax_first), withholding_class: p.withholding_class } : { ...blankForm, withholding_class: p.withholding_class });
    setOpen({ id: p.id, mode: 'edit' });
  }
  async function save(p: Person) {
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const body = {
      birth_date: form.birth_date || null, health_insured: form.health_insured, employment_insured: form.employment_insured,
      standard_monthly: num(form.standard_monthly), dependents: Number(form.dependents || 0), resident_tax: Number(form.resident_tax || 0), resident_tax_first: num(form.resident_tax_first),
      withholding_class: form.withholding_class,
    };
    const res = await api(`/api/autoflow/profiles/${p.id}`, 'PUT', body);
    if (!res.ok) { say({ type: 'error', text: ERR[(await res.json().catch(() => ({})))?.error] ?? '保存できませんでした' }); return; }
    say({ type: 'success', text: `${p.name}さんの登録を保存しました。次に作る下書きから反映されます（できた下書きは、明細の「控除を再計算」で）` });
    setOpen(null); load();
  }

  const [month, setMonth] = useState(currentMonth());
  const [amount, setAmount] = useState('');
  const [est, setEst] = useState<Estimate | null>(null);
  async function runEstimate(p: Person) {
    const body: Record<string, unknown> = { user_id: p.id, month };
    if (amount.trim() !== '') body.earnings_total = Number(amount);
    const res = await api('/api/autoflow/deductions/estimate', 'POST', body);
    if (!res.ok) { say({ type: 'error', text: '試算できませんでした（月・金額を確かめてください）' }); return; }
    setEst(await res.json());
  }

  if (!people) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const field = 'space-y-1 text-xs text-gray-600';
  return (
    <div className="space-y-3 max-w-3xl">
      <Notice msg={msg} />
      <p className="text-xs text-gray-500">
        給与から引く、社会保険料（健康保険・介護・子ども・子育て支援金・厚生年金）・雇用保険料・源泉所得税・住民税を自動で計算するための登録です。ここに登録した人だけ、固定報酬の下書きに控除が入ります（登録がない人は、控除なしで警告つきの下書きになります）。
        生年月日は、介護保険（40〜64歳）と年金・健康保険の年齢の範囲を決めるのに使い、経理と管理者だけが見られます。
      </p>
      {enabled === false && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">「流れの設定」の「控除の自動計算」がOFFです。登録と試算はできますが、下書きには入りません。</p>}
      <p className="text-xs text-gray-500">
        計算は、協会けんぽの料率（都道府県別）と標準報酬月額の等級表、国税庁の源泉徴収税額表（電算機計算の特例）に基づく概算で、年末調整で精算されます。組合健保・厚生年金基金、産休・育休の免除、賞与の控除は対象外です。標準報酬月額が変わったとき（算定・月額変更）は、ここで更新してください。
      </p>
      {people.length === 0 ? <p className="text-sm text-gray-400">対象の人がいません（役員・社員・正社員・パート）</p> : (
        <ul className="space-y-1.5">
          {people.map(p => (
            <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-2.5 text-sm space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{p.name}</span>
                <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{TYPE_LABEL[p.worker_type as WorkerType] ?? p.worker_type}</span>
                <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${p.profile ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{p.profile ? '登録済み' : '未登録'}</span>
                <span className="text-xs text-gray-500 flex-1 min-w-24">
                  {p.plan ? `固定報酬 ${yen(p.plan.amount)}${p.plan.commute_amount > 0 ? `＋通勤手当 ${yen(p.plan.commute_amount)}` : ''}` : '固定報酬なし'}
                  {p.profile && `・${p.withholding_class === 'ko' ? '甲欄' : '乙欄'}・扶養等 ${p.profile.dependents}人`}
                </span>
                <button className={`${btn} !px-2 !py-1 text-xs`} onClick={() => startEdit(p)}>{p.profile ? '変更' : '登録'}</button>
                <button className={`${btn} !px-2 !py-1 text-xs`} onClick={() => { setOpen({ id: p.id, mode: 'estimate' }); setEst(null); }}>試算</button>
              </div>
              {open?.id === p.id && open.mode === 'edit' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-gray-100 pt-2">
                  <label className={field}>生年月日<input type="date" className={inp} value={form.birth_date} onChange={e => setForm({ ...form, birth_date: e.target.value })} /></label>
                  <label className={field}>税額表
                    <select className={inp} value={form.withholding_class} onChange={e => setForm({ ...form, withholding_class: e.target.value as 'ko' | 'otsu' })}>
                      <option value="ko">甲欄（扶養控除等申告書を出している主たる給与）</option>
                      <option value="otsu">乙欄（従たる給与）</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={form.health_insured} onChange={e => setForm({ ...form, health_insured: e.target.checked })} />健康保険・厚生年金に入っている</label>
                  <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={form.employment_insured} onChange={e => setForm({ ...form, employment_insured: e.target.checked })} />雇用保険に入っている</label>
                  <label className={field}>標準報酬月額（円・空なら、その月の支給から等級を引く）<input type="number" min={1} inputMode="numeric" className={inp} value={form.standard_monthly} onChange={e => setForm({ ...form, standard_monthly: e.target.value })} /></label>
                  <label className={field}>扶養親族等の数（甲欄）／従たる給与の扶養親族等の数（乙欄）<input type="number" min={0} max={20} inputMode="numeric" className={inp} value={form.dependents} onChange={e => setForm({ ...form, dependents: e.target.value })} /></label>
                  <label className={field}>住民税（月額・特別徴収の通知額）<input type="number" min={0} inputMode="numeric" className={inp} value={form.resident_tax} onChange={e => setForm({ ...form, resident_tax: e.target.value })} /></label>
                  <label className={field}>6月に払う給与の住民税（通知書の初回分・空なら月額と同じ）<input type="number" min={0} inputMode="numeric" className={inp} value={form.resident_tax_first} onChange={e => setForm({ ...form, resident_tax_first: e.target.value })} /></label>
                  <div className="sm:col-span-2 flex gap-2">
                    <button className={btnPrimary} onClick={() => save(p)}>保存する</button>
                    <button className={btn} onClick={() => setOpen(null)}>やめる</button>
                  </div>
                </div>
              )}
              {open?.id === p.id && open.mode === 'estimate' && (
                <div className="border-t border-gray-100 pt-2 space-y-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className={field}>支給の月（期間の月）<input type="month" className={inp} value={month} onChange={e => setMonth(e.target.value)} /></label>
                    <label className={`${field} flex-1 min-w-40`}>支給額（円・空なら、その月の固定報酬と加算から）<input type="number" min={0} inputMode="numeric" className={inp} value={amount} onChange={e => setAmount(e.target.value)} /></label>
                    <button className={btnPrimary} onClick={() => runEstimate(p)}>試算する</button>
                    <button className={btn} onClick={() => setOpen(null)}>閉じる</button>
                  </div>
                  {est && (
                    <div className="rounded-lg bg-gray-50 p-2.5 text-xs space-y-1.5">
                      <p className="text-gray-700">{est.month}分・{est.pay_date}払い・支給 {yen(est.earnings_total)}{est.nontaxable > 0 ? `（うち非課税の通勤手当 ${yen(est.nontaxable)}）` : ''}</p>
                      {est.lines.length > 0 && (
                        <ul className="space-y-0.5">
                          {est.lines.map(l => <li key={l.key} className="flex justify-between"><span>{l.label}</span><span className="tabular-nums">−{yen(l.amount)}</span></li>)}
                          <li className="flex justify-between border-t border-gray-200 pt-0.5 font-semibold"><span>控除の合計</span><span className="tabular-nums">−{yen(est.deductions)}</span></li>
                          <li className="flex justify-between font-semibold"><span>差引支給額</span><span className="tabular-nums">{yen(est.net)}</span></li>
                        </ul>
                      )}
                      {est.notes.map((n, i) => <p key={i} className="text-gray-500">・{n}</p>)}
                      {est.warnings.map((w, i) => <p key={i} className="text-amber-700">⚠ {w}</p>)}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
