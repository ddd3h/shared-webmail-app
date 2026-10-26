'use client';
import { useCallback, useEffect, useState } from 'react';
import BlocksPanel from '@/components/security/BlocksPanel';
import PolicyPanel from '@/components/security/PolicyPanel';
import { EVENT_LABEL, SEVERITY_LABEL, SEVERITY_STYLE, reasonLabel, type Overview } from '@/components/security/types';

const when = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{label}</div><div className={`text-xl font-bold tabular-nums ${tone === 'bad' && value > 0 ? 'text-red-600' : 'text-gray-900'}`}>{value}</div></div>;
}

function TopList({ title, rows }: { title: string; rows: Overview['top_ips'] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-gray-400">なし</p> : <ul className="space-y-1">{rows.map(r => <li key={r.key} className="flex justify-between gap-2 text-sm"><span className="truncate font-mono text-gray-700">{r.key}</span><span className="tabular-nums text-gray-500">{r.count}回</span></li>)}</ul>}
    </div>
  );
}

export default function SecurityAdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/admin/security/overview'); if (r.ok) setData(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);

  async function resetMfa(id: string, name: string) {
    if (!confirm(`${name} さんの2段階認証をリセットします。ログイン中の端末はすべてログアウトされ、次回のログインで設定し直します。よろしいですか？`)) return;
    await fetch(`/api/admin/security/users/${id}/mfa-reset`, { method: 'POST' });
    load();
  }
  async function unlock(id: string) { await fetch(`/api/admin/security/users/${id}/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked: false }) }); load(); }

  if (!data) return <p className="text-sm text-gray-400">読み込み中…</p>;
  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-bold text-gray-900">セキュリティ</h1><p className="text-xs text-gray-500 mt-0.5">ログインの状況、不審なアクセスの検知、アクセスの条件</p></div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="ログイン失敗（24時間）" value={data.summary.failed_24h} tone="bad" /><Stat label="ログイン成功（24時間）" value={data.summary.succeeded_24h} />
        <Stat label="ログイン中のセッション" value={data.summary.active_sessions} /><Stat label="ブロック中のアドレス" value={data.summary.blocked} tone="bad" /><Stat label="ロック中のアカウント" value={data.summary.locked} tone="bad" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2"><TopList title="失敗が多いアドレス（24時間）" rows={data.top_ips} /><TopList title="狙われているアカウント（24時間）" rows={data.top_accounts} /></div>

      <BlocksPanel blocks={data.blocks} onChanged={load} />

      {data.locked.length > 0 && (
        <section className="card p-5 space-y-2" aria-label="ロック中のアカウント">
          <h2 className="font-semibold text-gray-900">ロック中のアカウント</h2>
          <ul className="divide-y divide-gray-100">{data.locked.map(u => <li key={u.id} className="flex items-center gap-3 py-2 text-sm"><span className="flex-1">{u.name}<span className="ml-2 text-xs text-gray-400">{u.email}</span></span><button onClick={() => unlock(u.id)} className="btn btn-secondary btn-sm" aria-label={`${u.name}のロックを解除`}>解除</button></li>)}</ul>
        </section>
      )}

      <section className="card p-5 space-y-2" aria-label="ログイン方法">
        <h2 className="font-semibold text-gray-900">ログイン方法（2段階認証・パスキー）</h2>
        <p className="text-xs text-gray-500">パスワードでログインするには2段階認証が必要です。どちらもない人は、次回のログイン時に2段階認証を設定します。</p>
        <ul className="divide-y divide-gray-100">
          {data.people.map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-[8rem] flex-1">{p.name}<span className="ml-2 text-xs text-gray-400">{p.email}</span></span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] ${p.mfa ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{p.mfa ? '2段階認証 有効' : '2段階認証 未設定'}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] ${p.passkeys > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>パスキー {p.passkeys}</span>
              {p.mfa && <button onClick={() => resetMfa(p.id, p.name)} className="btn btn-secondary btn-sm" aria-label={`${p.name}の2段階認証をリセット`}>リセット</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5 space-y-2" aria-label="セキュリティイベント">
        <h2 className="font-semibold text-gray-900">検知したできごと</h2>
        {data.events.length === 0 ? <p className="text-sm text-gray-400">まだありません</p> : (
          <ul className="divide-y divide-gray-100">
            {data.events.map(e => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_STYLE[e.severity]}`}>{SEVERITY_LABEL[e.severity]}</span>
                <span className="text-gray-900">{EVENT_LABEL[e.type] ?? e.type}</span>
                {e.ip && <span className="font-mono text-xs text-gray-500">{e.ip}</span>}
                {e.email && <span className="text-xs text-gray-500">{e.email}</span>}
                <span className="ml-auto text-xs text-gray-400">{when(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PolicyPanel />

      <section className="card p-5 space-y-2" aria-label="最近のログイン">
        <h2 className="font-semibold text-gray-900">最近のログイン</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-xs text-gray-500"><tr><th className="py-1 text-left">日時</th><th className="py-1 text-left">アカウント</th><th className="py-1 text-left">結果</th><th className="py-1 text-left">アドレス / 場所</th><th className="py-1 text-left">端末</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {data.recent_logins.map(l => (
              <tr key={l.id}><td className="py-1.5 whitespace-nowrap text-gray-600">{when(l.at)}</td><td className="py-1.5">{l.name ?? l.email}</td>
                <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[11px] ${l.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{l.success ? '成功' : `失敗${l.reason ? `（${reasonLabel(l.reason)}）` : ''}`}</span></td>
                <td className="py-1.5 text-gray-600"><span className="font-mono text-xs">{l.ip}</span> {l.place}</td><td className="py-1.5 text-gray-500">{l.device}</td></tr>
            ))}
          </tbody></table></div>
      </section>
    </div>
  );
}
