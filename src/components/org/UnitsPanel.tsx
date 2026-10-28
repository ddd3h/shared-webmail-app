'use client';
import { useState } from 'react';
import { Modal, Notice, api, btn, btnPrimary, inp } from '@/components/work/ui';
import { flattenTree, type OrgData, type OrgUnit } from './types';

type Draft = { id?: string; name: string; parent_id: string; head_user_id: string };
const ERRORS: Record<string, string> = { parent_loop: '自分の配下の部署は親にできません', has_children: '配下に部署があるため削除できません。先に移動・削除してください', parent_not_found: '親の部署が見つかりません', head_not_found: '部署長が見つかりません' };

async function errorText(res: Response) {
  const e = await res.json().catch(() => ({}));
  return ERRORS[e.error] ?? '保存できませんでした。入力を確認してください';
}

// 部署の追加・変更・削除（システム管理者）
export default function UnitsPanel({ data, onChanged }: { data: OrgData; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const tree = flattenTree(data.units);

  async function save() {
    if (!draft) return;
    const body = { name: draft.name, parent_id: draft.parent_id || null, head_user_id: draft.head_user_id || null };
    const res = draft.id ? await api(`/api/org/units/${draft.id}`, 'PUT', body) : await api('/api/org/units', 'POST', body);
    if (res.ok) { setDraft(null); setMsg({ type: 'success', text: '保存しました' }); onChanged(); } else setMsg({ type: 'error', text: await errorText(res) });
  }
  async function remove(u: OrgUnit) {
    if (!confirm(`「${u.name}」を削除しますか？ 所属していた人は「未所属」になります。`)) return;
    const res = await api(`/api/org/units/${u.id}`, 'DELETE');
    if (res.ok) { setMsg({ type: 'success', text: '削除しました' }); onChanged(); } else setMsg({ type: 'error', text: await errorText(res) });
  }
  // a unit can't be moved under itself or its own descendants
  const blocked = (id?: string) => new Set(id ? descendants(data.units, id) : []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="flex-1 text-xs text-gray-500">会社 → 部 → 課 のように、親子で組織をつくります。部署長が、その部署（配下を含む）のメンバーの承認・評価を担当します。</p>
        <button className={btnPrimary} onClick={() => setDraft({ name: '', parent_id: '', head_user_id: '' })}>＋ 部署を追加</button>
      </div>
      <Notice msg={msg} />
      {tree.length === 0 && <p className="text-sm text-gray-400">部署がありません</p>}
      <ul className="space-y-1.5">
        {tree.map(({ unit, depth }) => (
          <li key={unit.id} style={{ marginLeft: `${Math.min(depth, 5) * 1.25}rem` }} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
            <span className="flex-1 min-w-32 text-sm font-medium text-gray-900">{unit.name}<span className="ml-2 text-xs font-normal text-gray-500">部署長: {data.members.find(m => m.id === unit.head_user_id)?.name ?? '未設定'}</span></span>
            <button className="text-sm text-blue-600 hover:underline" onClick={() => setDraft({ id: unit.id, name: unit.name, parent_id: unit.parent_id ?? '', head_user_id: unit.head_user_id ?? '' })}>編集</button>
            <button className="text-sm text-red-600 hover:underline" onClick={() => remove(unit)}>削除</button>
          </li>
        ))}
      </ul>
      {draft && (
        <Modal title={draft.id ? '部署を編集' : '部署を追加'} onClose={() => setDraft(null)}>
          <div className="space-y-3">
            <div><label className="text-xs text-gray-600">部署名</label><input className={inp} placeholder="営業部" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><label className="text-xs text-gray-600">親の部署</label>
              <select className={inp} value={draft.parent_id} onChange={e => setDraft({ ...draft, parent_id: e.target.value })}>
                <option value="">（なし：最上位）</option>
                {data.units.filter(u => u.id !== draft.id && !blocked(draft.id).has(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select></div>
            <div><label className="text-xs text-gray-600">部署長</label>
              <select className={inp} value={draft.head_user_id} onChange={e => setDraft({ ...draft, head_user_id: e.target.value })}>
                <option value="">（未設定）</option>
                {data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></div>
          </div>
          <div className="flex justify-end gap-2 pt-4"><button className={btn} onClick={() => setDraft(null)}>閉じる</button><button className={btnPrimary} disabled={!draft.name.trim()} onClick={save}>保存</button></div>
        </Modal>
      )}
    </div>
  );
}

function descendants(units: OrgUnit[], rootId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => { for (const u of units) if (u.parent_id === id) { out.push(u.id); walk(u.id); } };
  walk(rootId);
  return out;
}
