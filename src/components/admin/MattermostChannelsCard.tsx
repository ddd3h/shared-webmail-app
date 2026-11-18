'use client';
import { useEffect, useState } from 'react';
import FoldCard from '@/components/mobile/FoldCard';

type Channel = { id: string; channel_id: string; name: string; visibility: 'public' | 'private'; sort_order: number; user_ids: string[] };
type Person = { id: string; name: string };
type Available = { channel_id: string; name: string; type: string; team: string };
const EMPTY = { channel_id: '', name: '', visibility: 'public' as 'public' | 'private', user_ids: [] as string[] };

// The channels the "Mattermostで議論" button can post to. Public: anybody who can see the thread. Private: only the people ticked here (and admins).
export default function MattermostChannelsCard() {
  const [items, setItems] = useState<Channel[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [avail, setAvail] = useState<Available[] | null>(null);
  const [editId, setEditId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await fetch('/api/admin/mattermost-channels').then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (d) { setItems(d.items); setPeople(d.people); }
  }
  useEffect(() => { load(); }, []);

  function edit(c: Channel | null) {
    setMsg(null);
    setEditId(c ? c.id : 'new');
    setForm(c ? { channel_id: c.channel_id, name: c.name, visibility: c.visibility, user_ids: c.user_ids } : EMPTY);
  }

  async function loadAvailable() {
    setMsg(null);
    const r = await fetch('/api/admin/mattermost-channels/available');
    const d = await r.json().catch(() => ({}));
    if (r.ok) setAvail(d.items);
    else setMsg({ ok: false, text: d.error === 'mattermost_not_configured' ? 'Base URLとBot Tokenを保存してから使ってください' : 'Mattermostから一覧を取得できませんでした' });
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(editId === 'new' ? '/api/admin/mattermost-channels' : `/api/admin/mattermost-channels/${editId}`, {
        method: editId === 'new' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, user_ids: form.visibility === 'private' ? form.user_ids : [] }),
      });
      const e = await res.json().catch(() => ({}));
      if (res.ok) { setEditId(null); await load(); setMsg({ ok: true, text: '保存しました' }); }
      else setMsg({ ok: false, text: e.error === 'duplicate' ? 'このチャンネルIDはもう登録されています' : '保存できませんでした。入力を確認してください' });
    } finally { setBusy(false); }
  }

  async function remove(c: Channel) {
    if (!confirm(`「${c.name}」を一覧から外しますか？（Mattermostの投稿は消えません）`)) return;
    const res = await fetch(`/api/admin/mattermost-channels/${c.id}`, { method: 'DELETE' });
    if (res.ok) { await load(); setMsg({ ok: true, text: '外しました' }); } else setMsg({ ok: false, text: '外せませんでした' });
  }

  const toggleUser = (id: string) => setForm(f => ({ ...f, user_ids: f.user_ids.includes(id) ? f.user_ids.filter(x => x !== id) : [...f.user_ids, id] }));

  return (
    <FoldCard title="Mattermost 議論の投稿先" label="Mattermost 議論の投稿先" className="card p-6" bodyClass="">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">「Mattermostで議論」ボタンで選べるチャンネルを登録します。公開は、スレッドを見られる人なら誰でも選べます。非公開は、選んだ人（と管理者）だけが選べます。</p>
        {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
        <ul className="space-y-1.5">
          {items.length === 0 && <li className="text-sm text-gray-400">登録されたチャンネルはありません</li>}
          {items.map(c => (
            <li key={c.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <span className="flex-1 truncate">{c.name}</span>
              <span className={`text-xs ${c.visibility === 'private' ? 'text-amber-600' : 'text-gray-400'}`}>{c.visibility === 'private' ? `非公開・${c.user_ids.length}人` : '公開'}</span>
              <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => edit(c)}>編集</button>
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => remove(c)}>外す</button>
            </li>
          ))}
        </ul>
        {editId === null ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => edit(null)}>チャンネルを追加</button>
        ) : (
          <div className="space-y-3 rounded-lg border border-gray-200 p-3">
            {editId === 'new' && (
              <div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={loadAvailable}>Botが入っているチャンネルから選ぶ</button>
                {avail && (
                  <select aria-label="Mattermostのチャンネル" className="input mt-2" value="" onChange={e => { const a = avail.find(x => x.channel_id === e.target.value); if (a) setForm(f => ({ ...f, channel_id: a.channel_id, name: a.name, visibility: a.type === 'private' ? 'private' : f.visibility })); }}>
                    <option value="">選んでください…</option>
                    {avail.map(a => <option key={a.channel_id} value={a.channel_id}>{a.team} / {a.name}{a.type === 'private' ? '（非公開）' : ''}</option>)}
                  </select>
                )}
              </div>
            )}
            <div><label className="label" htmlFor="mmc-name">表示名</label><input id="mmc-name" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label" htmlFor="mmc-id">チャンネルID</label><input id="mmc-id" className="input font-mono text-sm" value={form.channel_id} onChange={e => setForm({ ...form, channel_id: e.target.value })} /></div>
            <fieldset className="flex gap-4 text-sm">
              <legend className="label">誰が選べるか</legend>
              <label className="flex items-center gap-1"><input type="radio" name="mmc-vis" checked={form.visibility === 'public'} onChange={() => setForm({ ...form, visibility: 'public' })} />公開（誰でも）</label>
              <label className="flex items-center gap-1"><input type="radio" name="mmc-vis" checked={form.visibility === 'private'} onChange={() => setForm({ ...form, visibility: 'private' })} />非公開（選んだ人だけ）</label>
            </fieldset>
            {form.visibility === 'private' && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 p-2">
                {people.map(p => (
                  <label key={p.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" checked={form.user_ids.includes(p.id)} onChange={() => toggleUser(p.id)} />{p.name}</label>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" disabled={busy || !form.name.trim() || !form.channel_id.trim()} onClick={save}>保存</button>
              <button type="button" className="btn btn-secondary" onClick={() => setEditId(null)}>キャンセル</button>
            </div>
          </div>
        )}
      </div>
    </FoldCard>
  );
}
