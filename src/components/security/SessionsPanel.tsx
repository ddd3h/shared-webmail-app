'use client';
import { useCallback, useEffect, useState } from 'react';
import { deviceLabel } from '@/lib/device';

type Row = { id: string; ip_address: string; user_agent: string | null; network_type: string; expires_at: string; last_activity_at: string; created_at: string; user: { id: string; name: string; email: string } | null };

const NETWORK: Record<string, { label: string; cls: string }> = {
  public: { label: '公共', cls: 'bg-red-100 text-red-700' },
  semi_public: { label: '学校/病院', cls: 'bg-amber-100 text-amber-700' },
  hosting: { label: 'VPN/DC', cls: 'bg-purple-100 text-purple-700' },
  residential: { label: '自宅/オフィス', cls: 'bg-gray-100 text-gray-600' },
};
const when = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ログイン中の端末（セッション）。ここから強制的にログアウトさせられる。
export default function SessionsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/sessions', { cache: 'no-store' }).catch(() => null);
    setRows(r?.ok ? (await r.json()).items : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function revoke(row: Row) {
    if (!confirm(`${row.user?.name ?? 'このユーザー'} さんの、この端末のログインを終了します。よろしいですか？`)) return;
    setBusy(row.id);
    const res = await fetch(`/api/admin/sessions/${row.id}`, { method: 'DELETE' });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: 'ログインを終了しました' } : { ok: false, text: '終了できませんでした' });
    if (res.ok) void load();
  }

  return (
    <section aria-label="ログイン中の端末" className="card p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-gray-900">ログイン中の端末{rows && <span className="ml-2 text-xs font-normal text-gray-400">{rows.length}件</span>}</h2>
        <button onClick={load} className="btn btn-secondary btn-sm">更新</button>
      </div>
      {msg && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      {rows === null ? <p className="py-6 text-center text-xs text-gray-400">読み込み中…</p>
        : rows.length === 0 ? <p className="py-6 text-center text-xs text-gray-400">ログイン中の端末はありません</p>
        : (
          <ul className="divide-y divide-gray-100">
            {rows.map(s => {
              const nw = NETWORK[s.network_type] ?? { label: s.network_type, cls: 'bg-gray-100 text-gray-600' };
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                  <span className="min-w-36 flex-1"><span className="font-medium text-gray-900">{s.user?.name ?? '—'}</span><span className="block text-xs text-gray-400">{s.user?.email ?? ''}</span></span>
                  <span className="font-mono text-xs text-gray-600">{s.ip_address}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${nw.cls}`}>{nw.label}</span>
                  <span className="text-xs text-gray-500">{deviceLabel(s.user_agent)}</span>
                  <span className="text-xs text-gray-400">開始 {when(s.created_at)} ・ 期限 {when(s.expires_at)}</span>
                  <button onClick={() => revoke(s)} disabled={busy === s.id} aria-label={`${s.user?.name ?? ''}のこの端末を遮断`} className="btn btn-secondary btn-sm text-red-600 disabled:opacity-50">{busy === s.id ? '処理中…' : '遮断'}</button>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}
