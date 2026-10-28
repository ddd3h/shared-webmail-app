'use client';
import { useState } from 'react';
import { Modal, Notice, api, btn, btnPrimary, inp } from '@/components/work/ui';
import { CAPABILITY_KEYS, ORG_CAPABILITIES, type Capability } from '@/lib/org';
import type { OrgData, OrgPosition } from './types';

type Draft = { id?: string; name: string; level: string; permissions: Capability[] };

// 役職と、その役職が持つ権限（システム管理者）
export default function PositionsPanel({ data, onChanged }: { data: OrgData; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const holders = (p: OrgPosition) => data.members.flatMap(m => m.memberships).filter(m => m.position_id === p.id).length;
  const flash = (type: 'success' | 'error', text: string) => setMsg({ type, text });

  async function save() {
    if (!draft) return;
    const body = { name: draft.name, level: Number(draft.level) || 0, permissions: draft.permissions };
    const res = draft.id ? await api(`/api/org/positions/${draft.id}`, 'PUT', body) : await api('/api/org/positions', 'POST', body);
    if (res.ok) { setDraft(null); flash('success', '保存しました'); onChanged(); }
    else flash('error', (await res.json().catch(() => ({}))).error === 'duplicate_name' ? '同じ名前の役職があります' : '保存できませんでした');
  }
  async function remove(p: OrgPosition) {
    if (!confirm(`「${p.name}」を削除しますか？ ${holders(p)}件の所属が役職なしになります。`)) return;
    if ((await api(`/api/org/positions/${p.id}`, 'DELETE')).ok) { flash('success', '削除しました'); onChanged(); }
  }
  async function addDefaults() {
    const res = await api('/api/org/positions/defaults', 'POST');
    if (res.ok) { flash('success', `${(await res.json()).created}件の標準の役職を追加しました`); onChanged(); }
  }
  const toggle = (c: Capability) => draft && setDraft({ ...draft, permissions: draft.permissions.includes(c) ? draft.permissions.filter(x => x !== c) : [...draft.permissions, c] });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 min-w-48 text-xs text-gray-500">役職ごとに権限を決めます。権限は、その人が<b>この役職で所属している部署（配下の部署を含む）</b>に対して効きます。同じ人でも、部署ごとに別の役職にできます。</p>
        {data.positions.length === 0 && <button className={btn} onClick={addDefaults}>標準の役職を作成</button>}
        <button className={btnPrimary} onClick={() => setDraft({ name: '', level: '0', permissions: [] })}>＋ 役職を追加</button>
      </div>
      <Notice msg={msg} />
      {data.positions.length === 0 && <p className="text-sm text-gray-400">役職がありません。「標準の役職を作成」で 部長・課長・チームリーダー・メンバー を作れます。</p>}
      <ul className="space-y-2">
        {data.positions.map(p => (
          <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{p.name}</span>
              <span className="text-xs text-gray-400">{holders(p)}人</span>
              <div className="flex-1" />
              <button className="text-sm text-blue-600 hover:underline" onClick={() => setDraft({ id: p.id, name: p.name, level: String(p.level), permissions: p.permissions })}>編集</button>
              <button className="text-sm text-red-600 hover:underline" onClick={() => remove(p)}>削除</button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.permissions.length === 0 ? <span className="text-xs text-gray-400">権限なし</span> : p.permissions.map(c => <span key={c} className="rounded-sm bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">{ORG_CAPABILITIES[c].label}</span>)}
            </div>
          </li>
        ))}
      </ul>
      {draft && (
        <Modal title={draft.id ? '役職を編集' : '役職を追加'} onClose={() => setDraft(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <div><label className="text-xs text-gray-600">役職名</label><input className={inp} placeholder="課長" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
              <div><label className="text-xs text-gray-600">序列</label><input className={inp} type="number" min={0} max={100} value={draft.level} onChange={e => setDraft({ ...draft, level: e.target.value })} /></div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs text-gray-600">この役職の権限</legend>
              {CAPABILITY_KEYS.map(c => (
                <label key={c} className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={draft.permissions.includes(c)} onChange={() => toggle(c)} />
                  <span><span className="block text-sm text-gray-900">{ORG_CAPABILITIES[c].label}</span><span className="block text-xs text-gray-500">{ORG_CAPABILITIES[c].hint}</span></span>
                </label>
              ))}
            </fieldset>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setDraft(null)}>閉じる</button><button className={btnPrimary} disabled={!draft.name.trim()} onClick={save}>保存</button></div>
        </Modal>
      )}
    </div>
  );
}
