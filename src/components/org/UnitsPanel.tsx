'use client';
import { useState } from 'react';
import { Modal, Notice, api, btn, btnPrimary, inp } from '@/components/work/ui';
import { flattenTree, type OrgData, type OrgUnit } from './types';
import { membersOfUnit, putMemberships } from './memberships';

type Draft = { id?: string; name: string; parent_id: string };
const ERRORS: Record<string, string> = { parent_loop: '自分の配下の部署は親にできません', has_children: '配下に部署があるため削除できません。先に移動・削除してください', parent_not_found: '親の部署が見つかりません' };

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
    const body = { name: draft.name, parent_id: draft.parent_id || null };
    const res = draft.id ? await api(`/api/org/units/${draft.id}`, 'PUT', body) : await api('/api/org/units', 'POST', body);
    if (res.ok) { setDraft(null); setMsg({ type: 'success', text: '保存しました' }); onChanged(); } else setMsg({ type: 'error', text: await errorText(res) });
  }
  async function remove(u: OrgUnit) {
    if (!confirm(`「${u.name}」を削除しますか？ この部署のメンバーは、この部署から外れます（ほかの部署の所属はそのままです）。`)) return;
    const res = await api(`/api/org/units/${u.id}`, 'DELETE');
    if (res.ok) { setMsg({ type: 'success', text: '削除しました' }); onChanged(); } else setMsg({ type: 'error', text: await errorText(res) });
  }
  // 所属の追加・役職の変更・外す: a person's list of 所属 is saved as a whole
  const [add, setAdd] = useState<Record<string, { user: string; position: string }>>({});
  async function changeMembership(userId: string, unitId: string, position_id: string | null | 'remove') {
    const person = data.members.find(m => m.id === userId);
    if (!person) return;
    const others = person.memberships.filter(m => m.unit_id !== unitId);
    const next = position_id === 'remove' ? others : [...others, { unit_id: unitId, position_id }];
    const ok = await putMemberships(userId, next);
    setMsg(ok ? { type: 'success', text: `${person.name} さんを更新しました` } : { type: 'error', text: '更新できませんでした' });
    if (ok) onChanged();
  }
  async function addMember(unitId: string) {
    const a = add[unitId];
    if (!a?.user) return;
    await changeMembership(a.user, unitId, a.position || null);
    setAdd(x => ({ ...x, [unitId]: { user: '', position: a.position } }));
  }
  // a unit can't be moved under itself or its own descendants
  const blocked = (id?: string) => new Set(id ? descendants(data.units, id) : []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="flex-1 text-xs text-gray-500">部署は自由につくれます（会社 → 部 → 課 のように親子にもできます）。部署ごとにメンバーと役職を入れます。同じ人を複数の部署に、部署ごとに別の役職で入れられます（この部署では班長、あの部署では部長）。承認・評価の担当は、各部署の役職の権限で決まります。</p>
        <button className={btnPrimary} onClick={() => setDraft({ name: '', parent_id: '' })}>＋ 部署を追加</button>
      </div>
      <Notice msg={msg} />
      {tree.length === 0 && <p className="text-sm text-gray-400">部署がありません</p>}
      <ul className="space-y-2">
        {tree.map(({ unit, depth }) => {
          const people = membersOfUnit(data, unit.id);
          const inUnit = new Set(people.map(p => p.member.id));
          const a = add[unit.id] ?? { user: '', position: '' };
          return (
            <li key={unit.id} aria-label={unit.name} style={{ marginLeft: `${Math.min(depth, 5) * 1.25}rem` }} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-32 text-sm font-semibold text-gray-900">{unit.name}<span className="ml-2 text-xs font-normal text-gray-500">{people.length}人</span></span>
                <button className="text-sm text-blue-600 hover:underline" onClick={() => setDraft({ id: unit.id, name: unit.name, parent_id: unit.parent_id ?? '' })}>編集</button>
                <button className="text-sm text-red-600 hover:underline" onClick={() => remove(unit)}>削除</button>
              </div>
              {people.length > 0 && (
                <ul className="divide-y divide-gray-100">
                  {people.map(({ member, position_id }) => (
                    <li key={member.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <span className="min-w-24 flex-1 text-sm text-gray-800">{member.name}</span>
                      <select className={`${inp} max-w-40`} aria-label={`${unit.name}での${member.name}の役職`} value={position_id ?? ''} onChange={e => changeMembership(member.id, unit.id, e.target.value || null)}>
                        <option value="">（役職なし）</option>
                        {data.positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <button className="text-xs text-red-600 hover:underline" aria-label={`${member.name}を${unit.name}から外す`} onClick={() => changeMembership(member.id, unit.id, 'remove')}>外す</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                <select className={`${inp} max-w-44`} aria-label={`${unit.name}に入れる人`} value={a.user} onChange={e => setAdd(x => ({ ...x, [unit.id]: { ...a, user: e.target.value } }))}>
                  <option value="">メンバーを選ぶ</option>
                  {data.members.filter(m => !inUnit.has(m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <select className={`${inp} max-w-36`} aria-label={`${unit.name}での役職`} value={a.position} onChange={e => setAdd(x => ({ ...x, [unit.id]: { ...a, position: e.target.value } }))}>
                  <option value="">（役職なし）</option>
                  {data.positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button className={btn} disabled={!a.user} onClick={() => addMember(unit.id)}>＋ 追加</button>
              </div>
            </li>
          );
        })}
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
