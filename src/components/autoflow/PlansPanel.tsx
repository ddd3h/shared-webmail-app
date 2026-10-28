'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, btn, btnPrimary, currentMonth, inp, MonthNav, Notice, yen } from '@/components/work/ui';
import { defaultPlanLabel } from '@/lib/fixed-pay';
import { WORKER_TYPE_LABEL, type WorkerType } from '@/lib/work';

type Plan = { id: string; user_id: string; user_name: string; worker_type: string; label: string; amount: number; commute_amount: number; starts_month: string; ends_month: string | null; active: boolean; note: string | null };
type PayUser = { id: string; name: string; worker_type: string };
type Extra = { id: string; user_id: string; user_name: string; pay_month: string; kind: 'addon' | 'bonus'; label: string; amount: number };
type Draft = { user_id: string; user_name: string; month: string; label: string; amount: number; status: 'new' | 'exists' | 'conflict' | 'skipped'; deductions?: number; warnings?: string[] };
type Msg = { type: 'success' | 'error'; text: string } | null;

const typeLabel = (t: string) => WORKER_TYPE_LABEL[t as WorkerType] ?? t;
const defaultLabel = (t: string | undefined) => defaultPlanLabel((t ?? 'executive') as WorkerType);
const ERR: Record<string, string> = {
  overlap: 'その人の、期間が重なる固定報酬がすでにあります（同じ月に二重に払うことになります）',
  type_not_allowed: '役員・社員・正社員・パート・準業務委託の人だけ登録できます（派遣と業務委託は対象外です）',
  already_in_transfer: 'すでに全銀ファイルに入っているので、ここでは取り消せません',
  invalid_body: '入力を確かめてください（固定報酬の名前に「賞与」は使えません。賞与は下の欄で登録します）',
};
const DRAFT_STATUS = { new: ['作る', 'bg-blue-50 text-blue-700'], exists: ['作成済み', 'bg-emerald-50 text-emerald-700'], conflict: ['作らない（その月の明細がすでにある）', 'bg-amber-50 text-amber-700'], skipped: ['作らない（作ったあとに消された。「下書きを作る」で作り直せます）', 'bg-gray-100 text-gray-600'] } as const;
const errText = async (res: Response, fallback: string) => ERR[(await res.json().catch(() => ({})))?.error] ?? fallback;

// 役員・社員・準業務委託の固定の月額（と通勤手当）、その月だけの加算、賞与。控除は「控除の自動計算」がONなら下書きに入り、OFFなら明細で経理が入れる。
export default function PlansPanel() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [users, setUsers] = useState<PayUser[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const say = (m: Msg) => { setMsg(m); if (m) setTimeout(() => setMsg(null), 5000); };
  const load = useCallback(() => fetch('/api/autoflow/plans').then(r => r.json()).then(d => { setPlans(d.plans ?? []); setUsers(d.users ?? []); }).catch(() => setPlans([])), []);
  useEffect(() => { load(); }, [load]);

  // 固定報酬の登録
  const blank = { user_id: '', label: '', amount: '', commute_amount: '', starts_month: currentMonth(), ends_month: '' };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState<string | null>(null);
  async function savePlan() {
    const amount = Number(form.amount);
    if (!form.user_id || !Number.isInteger(amount) || amount < 1) { say({ type: 'error', text: '人と月額（円）を入れてください' }); return; }
    const commute = form.commute_amount === '' ? 0 : Number(form.commute_amount);
    if (!Number.isInteger(commute) || commute < 0) { say({ type: 'error', text: '通勤手当は0以上の整数（円）で入れてください' }); return; }
    const body = { user_id: form.user_id, label: form.label.trim() || defaultLabel(users.find(u => u.id === form.user_id)?.worker_type), amount, commute_amount: commute, starts_month: form.starts_month, ends_month: form.ends_month || null };
    const res = editId ? await api(`/api/autoflow/plans/${editId}`, 'PUT', body) : await api('/api/autoflow/plans', 'POST', body);
    if (!res.ok) { say({ type: 'error', text: await errText(res, '保存できませんでした') }); return; }
    say({ type: 'success', text: editId ? '変更しました。すでにできた明細の金額は変わりません' : '登録しました' });
    setForm(blank); setEditId(null); load();
  }
  async function togglePlan(p: Plan) {
    const res = await api(`/api/autoflow/plans/${p.id}`, 'PUT', { user_id: p.user_id, label: p.label, amount: p.amount, commute_amount: p.commute_amount, starts_month: p.starts_month, ends_month: p.ends_month, active: !p.active, note: p.note });
    if (!res.ok) say({ type: 'error', text: await errText(res, '変更できませんでした') }); else load();
  }
  async function removePlan(p: Plan) {
    if (!confirm(`${p.user_name}さんの「${p.label}」の登録を削除します。できた明細は残ります。よろしいですか？`)) return;
    const res = await api(`/api/autoflow/plans/${p.id}`, 'DELETE');
    if (!res.ok) say({ type: 'error', text: '削除できませんでした' }); else load();
  }

  // 加算・賞与
  const [month, setMonth] = useState(currentMonth());
  const [extras, setExtras] = useState<Extra[] | null>(null);
  const loadExtras = useCallback(() => fetch(`/api/autoflow/extras?month=${month}`).then(r => r.json()).then(d => setExtras(d.extras ?? [])).catch(() => setExtras([])), [month]);
  useEffect(() => { setExtras(null); loadExtras(); }, [loadExtras]);
  const [ex, setEx] = useState({ user_id: '', kind: 'addon' as 'addon' | 'bonus', label: '', amount: '' });
  async function addExtra() {
    const amount = Number(ex.amount);
    if (!ex.user_id || !ex.label.trim() || !Number.isInteger(amount) || amount < 1) { say({ type: 'error', text: '人・名目・金額（円）を入れてください' }); return; }
    const res = await api('/api/autoflow/extras', 'POST', { user_id: ex.user_id, pay_month: month, kind: ex.kind, label: ex.label.trim(), amount });
    if (!res.ok) { say({ type: 'error', text: await errText(res, '追加できませんでした') }); return; }
    const { reflect } = await res.json().catch(() => ({} as { reflect?: string }));
    say(ex.kind === 'bonus'
      ? { type: 'success', text: '賞与を登録しました。「振込」の月次まとめに出ます。控除は自動では入りません。賞与の明細で入れてください' }
      : reflect === 'edited' ? { type: 'error', text: '登録しました。ただし、この月の下書きは経理が明細を直したあとなので、加算は反映していません。給与明細の画面で、行を直接足してください' }
      : reflect === 'locked' ? { type: 'error', text: '登録しました。ただし、この月の明細は全銀ファイルに入っているか支払済みなので、加算は反映していません' }
      : { type: 'success', text: '加算を追加しました。その月の下書きがあれば、そこに足して、控除も計算し直しました' });
    setEx({ ...ex, label: '', amount: '' }); loadExtras();
  }
  async function removeExtra(e: Extra) {
    if (!confirm(`「${e.label}」（${yen(e.amount)}）を取り消します。よろしいですか？`)) return;
    const res = await api(`/api/autoflow/extras/${e.id}`, 'DELETE');
    if (!res.ok) { say({ type: 'error', text: await errText(res, '取り消せませんでした') }); return; }
    const { reflect } = await res.json().catch(() => ({} as { reflect?: string }));
    if (reflect === 'edited' || reflect === 'locked') say({ type: 'error', text: '取り消しました。ただし、この月の明細は直したあと／全銀ファイルに入っているので、明細の行は残っています。給与明細の画面で直してください' });
    loadExtras();
  }

  // 下書きを今すぐ作る
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  async function generate(dry: boolean) {
    const res = await api('/api/autoflow/fixed/generate', 'POST', { month, dry });
    if (!res.ok) { say({ type: 'error', text: '実行できませんでした' }); return; }
    const d = await res.json();
    setDrafts(d.drafts);
    if (!dry) say({ type: 'success', text: `${d.drafts.filter((x: Draft) => x.status === 'new').length}件の下書きを作りました` });
  }

  if (!plans) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const editing = plans.find(p => p.id === editId);
  return (
    <div className="space-y-6 max-w-3xl">
      <Notice msg={msg} />
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-gray-900">固定報酬（毎月の月額）</h2>
        <p className="text-xs text-gray-500">役員・社員・準業務委託は毎月の額が決まっているので、ここに登録すると、「流れの設定」で固定報酬をONにしたとき、毎月の締め日に給与明細の下書き（支払予定）を自動で作ります。通勤手当は別の行になり、月15万円までは非課税として所得税の対象から外します。社会保険料・所得税などの控除は、「流れの設定」で「控除の自動計算」をONにして「控除」のタブで登録すると、下書きに入ります（OFFのときは、できた下書きの明細で経理が入れます）。派遣と業務委託は対象外です。準業務委託の人は、これまでどおり業務報告書も出します。</p>
        {plans.length === 0 ? <p className="text-sm text-gray-400">まだ登録がありません</p> : (
          <ul className="space-y-1.5">
            {plans.map(p => (
              <li key={p.id} className={`rounded-xl border bg-white p-2.5 text-sm flex flex-wrap items-center gap-2 ${p.active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                <span className="font-medium text-gray-900">{p.user_name}</span>
                <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{typeLabel(p.worker_type)}</span>
                <span className="text-gray-700">{p.label}</span>
                <span className="font-semibold tabular-nums">{yen(p.amount)}</span>
                {p.commute_amount > 0 && <span className="text-xs text-gray-600">＋通勤手当 {yen(p.commute_amount)}</span>}
                <span className="text-xs text-gray-500 flex-1 min-w-32">{p.starts_month}〜{p.ends_month ?? '（続く）'}</span>
                <button className={`${btn} !px-2 !py-1 text-xs`} onClick={() => togglePlan(p)}>{p.active ? '止める' : '再開'}</button>
                <button className={`${btn} !px-2 !py-1 text-xs`} onClick={() => { setEditId(p.id); setForm({ user_id: p.user_id, label: p.label, amount: String(p.amount), commute_amount: p.commute_amount ? String(p.commute_amount) : '', starts_month: p.starts_month, ends_month: p.ends_month ?? '' }); }}>変更</button>
                <button className={`${btn} !px-2 !py-1 text-xs text-red-600`} onClick={() => removePlan(p)}>削除</button>
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-xl border border-gray-200 bg-white p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select aria-label="対象の人" className={inp} value={form.user_id} disabled={!!editing} onChange={e => setForm({ ...form, user_id: e.target.value })}>
            <option value="">人を選ぶ（役員・社員・準業務委託）</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}（{typeLabel(u.worker_type)}）</option>)}
          </select>
          <input aria-label="名前（明細の題名）" className={inp} placeholder={`名前（空なら ${defaultLabel(users.find(u => u.id === form.user_id)?.worker_type)}）`} value={form.label} maxLength={40} onChange={e => setForm({ ...form, label: e.target.value })} />
          <input aria-label="月額（円）" className={inp} type="number" min={1} inputMode="numeric" placeholder="月額（円）" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          <input aria-label="通勤手当（円・月額）" className={inp} type="number" min={0} inputMode="numeric" placeholder="通勤手当（円・月額・なければ空）" value={form.commute_amount} onChange={e => setForm({ ...form, commute_amount: e.target.value })} />
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <input aria-label="最初の月" className={inp} type="month" value={form.starts_month} onChange={e => setForm({ ...form, starts_month: e.target.value })} />〜
            <input aria-label="最後の月（空なら続く）" className={inp} type="month" value={form.ends_month} onChange={e => setForm({ ...form, ends_month: e.target.value })} />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button className={btnPrimary} onClick={savePlan}>{editId ? '変更を保存' : '登録する'}</button>
            {editId && <button className={btn} onClick={() => { setEditId(null); setForm(blank); }}>やめる</button>}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-gray-900">加算・賞与（その月だけ）</h2>
        <p className="text-xs text-gray-500">「加算」はその月の下書きに足します（通勤手当や業務の追加分など）。「賞与」は、別の給与明細（支払予定）になり、「振込」の月次まとめに「賞与」として出ます（月次まとめの全銀データは総合振込です。賞与振込の区分で出したいときは、「給与の振込」のタブで作ります）。期間は、固定報酬の「月」と同じ、締め日で区切った月です。</p>
        <MonthNav month={month} onChange={setMonth} />
        {extras === null ? <p className="text-sm text-gray-400">読み込み中…</p> : extras.length === 0 ? <p className="text-sm text-gray-400">この月の加算・賞与はありません</p> : (
          <ul className="space-y-1.5">
            {extras.map(e => (
              <li key={e.id} className="rounded-xl border border-gray-200 bg-white p-2.5 text-sm flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{e.user_name}</span>
                <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${e.kind === 'bonus' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{e.kind === 'bonus' ? '賞与' : '加算'}</span>
                <span className="text-gray-700 flex-1 min-w-24">{e.label}</span>
                <span className="font-semibold tabular-nums">{yen(e.amount)}</span>
                <button className={`${btn} !px-2 !py-1 text-xs text-red-600`} onClick={() => removeExtra(e)}>取り消す</button>
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-xl border border-gray-200 bg-white p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select aria-label="加算・賞与の対象の人" className={inp} value={ex.user_id} onChange={e => setEx({ ...ex, user_id: e.target.value })}>
            <option value="">人を選ぶ</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}（{typeLabel(u.worker_type)}）</option>)}
          </select>
          <select aria-label="種類" className={inp} value={ex.kind} onChange={e => setEx({ ...ex, kind: e.target.value as 'addon' | 'bonus' })}>
            <option value="addon">加算（下書きに足す）</option>
            <option value="bonus">賞与（別の明細）</option>
          </select>
          <input aria-label="名目" className={inp} placeholder={ex.kind === 'bonus' ? '名目（例: 夏季賞与）' : '名目（例: 通勤手当）'} value={ex.label} maxLength={40} onChange={e => setEx({ ...ex, label: e.target.value })} />
          <input aria-label="金額（円）" className={inp} type="number" min={1} inputMode="numeric" placeholder="金額（円）" value={ex.amount} onChange={e => setEx({ ...ex, amount: e.target.value })} />
          <div className="sm:col-span-2"><button className={btnPrimary} onClick={addExtra}>この月に追加</button></div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-gray-900">下書きを今すぐ作る</h2>
        <p className="text-xs text-gray-500">上で選んだ月の分を、登録された固定報酬から作ります（自動の作成を待たずに作りたいとき）。すでにある月は、増えません。その月に手で入れた明細がある人は、二重に払わないよう作りません。自動で作った下書きを消した月は、毎日の自動作成では作り直さないので、その月を払わないときは下書きを消してください（ここで作ると作り直せます）。</p>
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => generate(true)}>作る内容を確認</button>
          <button className={btnPrimary} onClick={() => generate(false)}>{month}分の下書きを作る</button>
        </div>
        {drafts && (drafts.length === 0 ? <p className="text-sm text-gray-400">この月に払う固定報酬はありません</p> : (
          <ul className="space-y-1">
            {drafts.map(d => (
              <li key={d.user_id} className="rounded-xl border border-gray-200 bg-white p-2.5 text-sm flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{d.user_name}</span>
                <span className="text-gray-700 flex-1 min-w-24">{d.label}</span>
                <span className="font-semibold tabular-nums">{yen(d.amount)}</span>
                {d.deductions !== undefined && <span className="text-xs text-gray-600">控除 {yen(d.deductions)}</span>}
                <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${DRAFT_STATUS[d.status][1]}`}>{DRAFT_STATUS[d.status][0]}</span>
                {d.warnings?.map((w, i) => <p key={i} className="basis-full text-xs text-amber-700">⚠ {w}</p>)}
              </li>
            ))}
          </ul>
        ))}
      </section>
    </div>
  );
}
