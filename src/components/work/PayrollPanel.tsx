'use client';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Notice, Stat, btn, btnPrimary, currentMonth, inp, yen, api, TYPE_LABEL, type WorkerType, PanelSkeleton } from './ui';
import Link from 'next/link';
import { shortDate } from '@/lib/pay-schedule';
import { WITHHOLDING_CLASSES, WITHHOLDING_HELP, WITHHOLDING_LABEL, paysSalary, type WithholdingClass } from '@/lib/work';

type Item = { id?: string; kind: 'earning' | 'deduction'; label: string; amount: number; system?: boolean };
type LinkedClaim = { id: string; title: string; amount: number; expense_date: string };
type Slip = {
  id: string; user: { id: string; name: string; worker_type: WorkerType }; pay_month: string; title: string; status: 'planned' | 'paid';
  pay_date: string | null; note: string | null; items: Item[]; claims: LinkedClaim[]; earnings: number; deductions: number; net: number;
  auto_draft?: { edited: boolean } | null; // オートフローが固定報酬から作った下書き（支払予定・全銀ファイル前）
};
type Summary = { month: string; planned_total: number; paid_total: number; count: number };
type Draft = { id?: string; userId: string; pay_month: string; title: string; status: 'planned' | 'paid'; pay_date: string; note: string; items: { kind: 'earning' | 'deduction'; label: string; amount: string }[]; system: { label: string; amount: number } | null ; date_touched?: boolean; hint?: string };

// 所得税 is typed in by hand; the label says which 源泉徴収 table it was worked out with
const taxLabel = (c: WithholdingClass) => `所得税（${WITHHOLDING_LABEL[c]}）`;
const isTaxLabel = (l: string) => /^所得税(（[甲乙]欄）)?$/.test(l);
const monthLabel = (m: string) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
const StatusBadge = ({ s }: { s: string }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{s === 'paid' ? '支払済' : '支払予定'}</span>
);

// Own pay statements (default) or, for admins (`manage`), everyone's with create/edit.
export default function PayrollPanel({ manage = false, members = [], noun = '給与' }: { manage?: boolean; members?: { id: string; name: string; worker_type: WorkerType; withholding_class?: WithholdingClass }[]; noun?: string }) {
  const [items, setItems] = useState<Slip[]>([]);
  const [loaded, setLoaded] = useState(false);   // the first answer has arrived (until then: a placeholder, not "nothing here")
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [wcChosen, setWcChosen] = useState<Record<string, WithholdingClass>>({});   // 源泉徴収の欄 changed on this screen
  const wcOf = (id: string): WithholdingClass => wcChosen[id] ?? members.find(m => m.id === id)?.withholding_class ?? 'ko';
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams(manage ? (filter ? { userId: filter } : {}) : { mine: '1' });
    const res = await fetch(`/api/work/payslips?${q}`);
    if (res.ok) { const d = await res.json(); setItems(d.items); setSummary(d.summary); }
    setLoaded(true);
  }, [filter, manage]);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  const blank = (): Draft => ({
    userId: filter || members[0]?.id || '', pay_month: currentMonth(), title: noun, status: 'planned', pay_date: '', note: '',
    items: [{ kind: 'earning', label: '基本給', amount: '' }, { kind: 'deduction', label: '社会保険料', amount: '' }, { kind: 'deduction', label: taxLabel(wcOf(filter || members[0]?.id || '')), amount: '' }],
    system: null,
  });
  // a new statement starts with the pay date of the person's kind of worker (締め日・振込日); a date typed by hand is left alone
  const dUser = draft && !draft.id ? draft.userId : '', dMonth = draft && !draft.id ? draft.pay_month : '', dTouched = !!draft?.date_touched;
  useEffect(() => {
    if (!dUser || !/^\d{4}-\d{2}$/.test(dMonth)) return;
    let stale = false;
    fetch(`/api/work/schedule?${new URLSearchParams({ userId: dUser, month: dMonth })}`).then(r => r.ok ? r.json() : null).then(s => {
      if (stale || !s) return;
      setDraft(d => d && !d.id && d.userId === dUser && d.pay_month === dMonth
        ? { ...d, hint: `${s.summary}（${Number(dMonth.slice(5))}月分は ${shortDate(s.period.closing_date)} 締め）`, ...(d.date_touched ? {} : { pay_date: s.period.pay_date }) }
        : d);
    }).catch(() => {});
    return () => { stale = true; };
  }, [dUser, dMonth, dTouched]);
  const draftNet = draft ? draft.items.reduce((s, i) => s + (i.kind === 'earning' ? 1 : -1) * (Number(i.amount) || 0), 0) + (draft.system?.amount ?? 0) : 0;

  // the person's 源泉徴収の欄 (甲欄 / 乙欄): saved at once; a default 所得税 row follows it
  async function setWithholding(userId: string, c: WithholdingClass) {
    const res = await api(`/api/work/users/${userId}`, 'PATCH', { withholding_class: c });
    if (!res.ok) { flash('error', '源泉徴収の欄を変更できませんでした'); return; }
    setWcChosen(w => ({ ...w, [userId]: c }));
    setDraft(d => d && { ...d, items: d.items.map(i => (i.kind === 'deduction' && isTaxLabel(i.label) ? { ...i, label: taxLabel(c) } : i)) });
    flash('success', `源泉徴収を${WITHHOLDING_LABEL[c]}にしました`);
  }
  async function save() {
    if (!draft) return;
    const items = draft.items.filter(i => i.label.trim() && i.amount !== '').map(i => ({ kind: i.kind, label: i.label, amount: Math.round(Number(i.amount)) }));
    const body = { pay_month: draft.pay_month, title: draft.title, status: draft.status, pay_date: draft.pay_date || null, note: draft.note || null, items };
    const res = draft.id ? await api(`/api/work/payslips/${draft.id}`, 'PUT', body) : await api('/api/work/payslips', 'POST', { ...body, userId: draft.userId });
    if (res.ok) { setDraft(null); flash('success', '明細を保存しました'); load(); } else flash('error', '保存に失敗しました。項目と金額（0以上の整数）を確認してください');
  }
  // 控除の自動計算（オートフロー）で入れた控除の行を、いまの支給の行からもう一度計算する
  async function recalc(id: string) {
    const res = await api('/api/autoflow/deductions/recalc', 'POST', { payslip_id: id });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({})))?.error;
      flash('error', e === 'disabled' ? '「オートフロー → 流れの設定」で、控除の自動計算をONにしてください' : e === 'locked' ? '全銀データに含まれているか支払済みのため、再計算できません' : '再計算できませんでした');
      return;
    }
    const d = await res.json();
    flash('success', d.warnings?.length ? `控除を再計算しました（警告 ${d.warnings.length}件。メモを確認してください）` : '控除を再計算しました');
    load();
  }
  async function remove(id: string) {
    if (!confirm('この明細を削除しますか？')) return;
    const res = await api(`/api/work/payslips/${id}`, 'DELETE');
    if (res.ok) load(); else flash('error', '削除に失敗しました');
  }
  function editDraft(p: Slip): Draft {
    return { id: p.id, userId: p.user.id, pay_month: p.pay_month, title: p.title, status: p.status, pay_date: p.pay_date || '', note: p.note || '',
      items: p.items.filter(i => !i.system).map(i => ({ kind: i.kind, label: i.label, amount: String(i.amount) })),
      system: (() => { const x = p.items.find(i => i.system); return x ? { label: x.label, amount: x.amount } : null; })() };
  }

  return (
    <div className="space-y-4">
      {!loaded && <PanelSkeleton />}
      {summary && (
        <div className="tab-fade grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label={`${monthLabel(summary.month)}の支払予定額`} value={yen(summary.planned_total)} sub={manage ? '全員の未払い分の合計（手取り）' : 'まだ支払われていない金額（手取り）'} />
          <Stat label={`${monthLabel(summary.month)}の支払済`} value={yen(summary.paid_total)} />
          <Stat label="今月の合計" value={yen(summary.planned_total + summary.paid_total)} sub={`${summary.count}件`} />
        </div>
      )}
      <Notice msg={msg} />
      {!manage && <p className="text-xs text-gray-500">振込先の口座は <Link href="/profile#bank" className="text-blue-600 hover:underline">プロフィール › 受取口座</Link> で登録します。</p>}
      {manage && (
        <div className="flex flex-wrap items-center gap-3">
          <select className={`${inp} max-w-56`} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">全員</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}（{TYPE_LABEL[m.worker_type]}）</option>)}
          </select>
          <div className="flex-1" />
          <button className={btnPrimary} onClick={() => setDraft(blank())}>＋ 明細を登録</button>
        </div>
      )}

      <div className={`space-y-2 ${loaded ? 'tab-fade' : ''}`}>
        {loaded && items.length === 0 && <p className="text-sm text-gray-400">明細はまだありません</p>}
        {items.map(p => (
          <div key={p.id} className="rounded-xl border border-gray-200 bg-white">
            <button className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
              <div className="min-w-24"><div className="text-sm font-semibold text-gray-900">{monthLabel(p.pay_month)}</div><div className="text-xs text-gray-500">{p.title}{manage ? ` ・ ${p.user.name}` : ''}</div></div>
              <StatusBadge s={p.status} />
              <div className="ml-auto text-right"><div className="text-xs text-gray-500">手取り</div><div className="text-lg font-bold tabular-nums">{yen(p.net)}</div></div>
            </button>
            {open === p.id && (
              <div className="border-t border-gray-100 p-3 text-sm space-y-3">
                {(['earning', 'deduction'] as const).map(kind => (
                  <div key={kind}>
                    <div className="text-xs font-semibold text-gray-500 mb-1">{kind === 'earning' ? '支給' : '控除'}</div>
                    {p.items.filter(i => i.kind === kind).map((i, idx) => (
                      <div key={idx} className="flex justify-between py-0.5"><span>{i.label}{i.system && <span className="ml-2 rounded-sm bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">経費申請から自動連動</span>}</span><span className="tabular-nums">{kind === 'deduction' ? '−' : ''}{yen(i.amount)}</span></div>
                    ))}
                    <div className="flex justify-between border-t border-gray-100 mt-1 pt-1 font-medium"><span>{kind === 'earning' ? '支給合計' : '控除合計'}</span><span className="tabular-nums">{yen(kind === 'earning' ? p.earnings : p.deductions)}</span></div>
                  </div>
                ))}
                {p.claims.length > 0 && (
                  <div className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2 text-xs text-gray-600">
                    <div className="font-semibold text-violet-700 mb-1">立替金精算の内訳</div>
                    {p.claims.map(c => <div key={c.id} className="flex justify-between"><span>{c.expense_date.slice(5).replace('-', '/')} {c.title}</span><span className="tabular-nums">{yen(c.amount)}</span></div>)}
                  </div>
                )}
                <div className="flex justify-between rounded-lg bg-gray-50 px-3 py-2 font-bold"><span>差引支給額（手取り）</span><span className="tabular-nums">{yen(p.net)}</span></div>
                <div className="text-xs text-gray-500 whitespace-pre-line">{p.pay_date ? `支払日: ${p.pay_date}` : '支払日: 未定'}{p.note ? `\n${p.note}` : ''}</div>
                {manage && <div className="flex gap-3 text-xs"><button className="text-blue-600 hover:underline" onClick={() => setDraft(editDraft(p))}>編集</button>{p.auto_draft && <button className="text-blue-600 hover:underline" onClick={() => recalc(p.id)} title="自動で入れた控除の行（健康保険料・所得税など）を、いまの支給の行から計算し直します。自分で足した控除の行は残ります">控除を再計算</button>}<button className="text-red-600 hover:underline" onClick={() => remove(p.id)}>削除</button></div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {draft && (
        <Modal title={draft.id ? '明細を編集' : '明細を登録'} onClose={() => setDraft(null)}>
          <div className="space-y-3">
            {!draft.id && (
              <div><label className="text-xs text-gray-600" htmlFor="payslip-user">対象者</label>
                <select id="payslip-user" className={inp} value={draft.userId} onChange={e => setDraft({ ...draft, userId: e.target.value, items: draft.items.map(i => (i.kind === 'deduction' && isTaxLabel(i.label) ? { ...i, label: taxLabel(wcOf(e.target.value)) } : i)) })}>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}（{TYPE_LABEL[m.worker_type]}）</option>)}
                </select></div>
            )}
            {manage && (() => {
              const who = members.find(m => m.id === draft.userId);
              if (!who || !(paysSalary(who.worker_type) || who.worker_type === 'executive')) return null;
              const c = wcOf(who.id);
              return (
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-semibold text-gray-600" htmlFor="withholding-class">源泉徴収（所得税）の欄</label>
                    <select id="withholding-class" className="rounded-lg border border-gray-300 px-2 py-1 text-sm" value={c} onChange={e => setWithholding(who.id, e.target.value as WithholdingClass)}>
                      {WITHHOLDING_CLASSES.map(k => <option key={k} value={k}>{WITHHOLDING_LABEL[k]}</option>)}
                    </select>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{WITHHOLDING_HELP[c]}。税額は、{WITHHOLDING_LABEL[c]}の源泉徴収税額表で調べて、下の「所得税」に入れてください。</p>
                </div>
              );
            })()}
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-600">対象月</label><input type="month" className={inp} value={draft.pay_month} onChange={e => setDraft({ ...draft, pay_month: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">名称</label><input className={inp} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">状態</label>
                <select className={inp} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as 'planned' | 'paid' })}><option value="planned">支払予定</option><option value="paid">支払済</option></select></div>
              <div><label className="text-xs text-gray-600">支払日</label><input type="date" className={inp} value={draft.pay_date} onChange={e => setDraft({ ...draft, pay_date: e.target.value, date_touched: true })} /></div>
            </div>
            {draft.hint && !draft.id && <p className="text-xs text-gray-500">支払日の初期値は、この人の区分の「{draft.hint}」から入れています。</p>}
            {draft.system && draft.status === 'paid' && <p className="text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">支払済にすると、この明細に合算された立替金も返金済になります。</p>}
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">明細項目（金額は円・0以上の整数）</div>
              <div className="space-y-2">
                {draft.items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-[5.5rem_1fr_7rem_auto] gap-2 items-center">
                    <select className={inp} value={it.kind} onChange={e => setDraft({ ...draft, items: draft.items.map((x, i) => i === idx ? { ...x, kind: e.target.value as 'earning' | 'deduction' } : x) })}><option value="earning">支給</option><option value="deduction">控除</option></select>
                    <input className={inp} placeholder="項目名" value={it.label} onChange={e => setDraft({ ...draft, items: draft.items.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) })} />
                    <input className={`${inp} text-right`} type="number" min={0} placeholder="0" value={it.amount} onChange={e => setDraft({ ...draft, items: draft.items.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x) })} />
                    <button className="text-gray-400 hover:text-red-600 px-1" aria-label="項目を削除" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== idx) })}>✕</button>
                  </div>
                ))}
              </div>
              {draft.system && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-sm"><span>{draft.system.label}<span className="ml-2 rounded-sm bg-white px-1.5 py-0.5 text-[10px] text-violet-700">自動連動・編集不可</span></span><span className="tabular-nums">{yen(draft.system.amount)}</span></div>
              )}
              <button className="mt-2 text-xs text-blue-600 hover:underline" onClick={() => setDraft({ ...draft, items: [...draft.items, { kind: 'earning', label: '', amount: '' }] })}>＋ 項目を追加</button>
            </div>
            <div className="flex justify-between rounded-lg bg-gray-50 px-3 py-2 font-bold"><span>差引支給額（手取り）</span><span className="tabular-nums">{yen(draftNet)}</span></div>
            <div><label className="text-xs text-gray-600">備考</label><input className={inp} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setDraft(null)}>閉じる</button><button className={btnPrimary} onClick={save}>保存</button></div>
        </Modal>
      )}
    </div>
  );
}
