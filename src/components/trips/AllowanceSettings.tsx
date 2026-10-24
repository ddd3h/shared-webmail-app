'use client';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Notice, api, btn, btnPrimary, inp, yen } from '@/components/work/ui';
import { KIND_LABEL, UNIT_LABEL, type RateType } from './shared';

type Draft = { id?: string; name: string; kind: 'daily' | 'addon'; unit: 'per_day' | 'per_night' | 'per_trip'; amount: string; description: string; sort: string; is_active: boolean };

export default function AllowanceSettings({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<RateType[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/trips/allowance-types?all=1');
    if (res.ok) setItems((await res.json()).items);
  }, []);
  useEffect(() => { load(); }, [load]);
  function flash(type: 'success' | 'error', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  const blank = (): Draft => ({ name: '', kind: 'addon', unit: 'per_day', amount: '', description: '', sort: String((items.at(-1)?.sort ?? 0) + 10), is_active: true });

  async function save() {
    if (!draft) return;
    const body = { name: draft.name, kind: draft.kind, unit: draft.unit, amount: Math.round(Number(draft.amount)), description: draft.description || null, sort: Number(draft.sort) || 0, is_active: draft.is_active };
    const res = draft.id ? await api(`/api/trips/allowance-types/${draft.id}`, 'PUT', body) : await api('/api/trips/allowance-types', 'POST', body);
    if (res.ok) { setDraft(null); flash('success', '保存しました'); load(); onChanged(); } else flash('error', '保存に失敗しました。名称と金額（0以上の整数）を確認してください');
  }
  async function remove(t: RateType) {
    if (!confirm(`「${t.name}」を削除しますか？（申請で使用済みの場合は無効になるだけです）`)) return;
    const res = await api(`/api/trips/allowance-types/${t.id}`, 'DELETE');
    if (res.ok) { const d = await res.json(); flash('success', d.deactivated ? '使用済みのため無効にしました' : '削除しました'); load(); onChanged(); }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">出張申請で選べる<b>日当</b>（出張ごとに1つ）と、<b>業務内容による加算金</b>（該当するものを複数）を設定します。金額を変えても、すでに申請された出張の手当は変わりません。</p>
      <Notice msg={msg} />
      <div className="flex justify-end"><button className={btnPrimary} onClick={() => setDraft(blank())}>＋ 手当を追加</button></div>
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-3 py-2 text-left">名称</th><th className="px-3 py-2 text-left">種類</th><th className="px-3 py-2 text-right">金額</th><th className="px-3 py-2 text-left">単位</th><th className="px-3 py-2 text-left">状態</th><th /></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(t => (
              <tr key={t.id} className={t.is_active ? '' : 'text-gray-400'}>
                <td className="px-3 py-2 whitespace-normal min-w-[10rem]"><div className="font-medium">{t.name}</div>{t.description && <div className="text-[11px] text-gray-400">{t.description}</div>}</td>
                <td className="px-3 py-2">{KIND_LABEL[t.kind]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{yen(t.amount)}</td>
                <td className="px-3 py-2">{UNIT_LABEL[t.unit]}</td>
                <td className="px-3 py-2">{t.is_active ? '有効' : '無効'}</td>
                <td className="px-3 py-2 text-right text-xs">
                  <button className="text-blue-600 hover:underline mr-3" onClick={() => setDraft({ id: t.id, name: t.name, kind: t.kind, unit: t.unit, amount: String(t.amount), description: t.description || '', sort: String(t.sort), is_active: t.is_active })}>編集</button>
                  <button className="text-red-600 hover:underline" onClick={() => remove(t)}>削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <Modal title={draft.id ? '手当を編集' : '手当を追加'} onClose={() => setDraft(null)}>
          <div className="space-y-3">
            <div><label className="text-xs text-gray-600">名称</label><input className={inp} placeholder="例: 現場作業手当" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-600">種類</label>
                <select className={inp} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as 'daily' | 'addon' })}><option value="daily">日当（1つだけ選ぶ）</option><option value="addon">加算金（複数選べる）</option></select></div>
              <div><label className="text-xs text-gray-600">単位</label>
                <select className={inp} value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value as Draft['unit'] })}><option value="per_day">1日あたり（日数分）</option><option value="per_night">1泊あたり（泊数分）</option><option value="per_trip">1回あたり（定額）</option></select></div>
              <div><label className="text-xs text-gray-600">金額（円）</label><input type="number" min={0} className={`${inp} text-right`} value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">表示順</label><input type="number" min={0} className={`${inp} text-right`} value={draft.sort} onChange={e => setDraft({ ...draft, sort: e.target.value })} /></div>
            </div>
            <div><label className="text-xs text-gray-600">説明（申請画面に表示）</label><input className={inp} placeholder="例: 客先・現場での作業がある場合" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.is_active} onChange={e => setDraft({ ...draft, is_active: e.target.checked })} />申請画面で選べるようにする</label>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setDraft(null)}>閉じる</button><button className={btnPrimary} disabled={!draft.name.trim() || draft.amount === ''} onClick={save}>保存</button></div>
        </Modal>
      )}
    </div>
  );
}
