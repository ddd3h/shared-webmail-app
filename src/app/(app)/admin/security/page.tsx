'use client';
import FoldCard from '@/components/mobile/FoldCard';
import { useCallback, useEffect, useState } from 'react';
import BlocksPanel from '@/components/security/BlocksPanel';
import LoginHistoryPanel from '@/components/security/LoginHistoryPanel';
import PolicyPanel from '@/components/security/PolicyPanel';
import SessionsPanel from '@/components/security/SessionsPanel';
import { EVENT_LABEL, SEVERITY_LABEL, SEVERITY_STYLE, type Overview, type People } from '@/components/security/types';

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

// 概要: the last 24 hours at a glance
function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/admin/security/overview?lite=1', { cache: 'no-store' }); if (r.ok) setData(await r.json()); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <p className="text-sm text-gray-400">読み込み中…</p>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="ログイン失敗（24時間）" value={data.summary.failed_24h} tone="bad" /><Stat label="ログイン成功（24時間）" value={data.summary.succeeded_24h} />
        <Stat label="ログイン中のセッション" value={data.summary.active_sessions} /><Stat label="ブロック中のアドレス" value={data.summary.blocked} tone="bad" /><Stat label="ロック中のアカウント" value={data.summary.locked} tone="bad" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2"><TopList title="失敗が多いアドレス（24時間）" rows={data.top_ips} /><TopList title="狙われているアカウント（24時間）" rows={data.top_accounts} /></div>
      <BlocksPanel blocks={data.blocks} onChanged={load} />
      <FoldCard title="検知したできごと" label="セキュリティイベント" badge={`${data.events.length}件`}>
        {data.events.length === 0 ? <p className="text-sm text-gray-400">まだありません</p> : (
          <ul className="divide-y divide-gray-100">
            {data.events.map(e => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_STYLE[e.severity]}`}>{SEVERITY_LABEL[e.severity]}</span>
                <span className="text-gray-900">{EVENT_LABEL[e.type] ?? e.type}</span>
                {e.ip && <span className="font-mono text-xs text-gray-500">{e.ip}</span>}
                {e.email && <span className="text-xs text-gray-500">{e.email}</span>}
                <span className="ml-auto text-xs text-gray-400">{when(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </FoldCard>
    </div>
  );
}

// アカウントと端末: locked accounts, how everybody logs in, who is logged in right now
function AccountsTab() {
  const [data, setData] = useState<People | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/admin/security/people', { cache: 'no-store' }); if (r.ok) setData(await r.json()); }, []);
  useEffect(() => { void load(); }, [load]);

  async function resetMfa(id: string, name: string) {
    if (!confirm(`${name} さんの2段階認証をリセットします。ログイン中の端末はすべてログアウトされ、次回のログインで設定し直します。よろしいですか？`)) return;
    await fetch(`/api/admin/security/users/${id}/mfa-reset`, { method: 'POST' });
    void load();
  }
  async function unlock(id: string) { await fetch(`/api/admin/security/users/${id}/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked: false }) }); void load(); }

  return (
    <div className="space-y-5">
      {!data ? <p className="text-sm text-gray-400">読み込み中…</p> : (
        <>
          {data.locked.length > 0 && (
            <FoldCard title="ロック中のアカウント" label="ロック中のアカウント" defaultOpen badge={`${data.locked.length}件`}>
              <ul className="divide-y divide-gray-100">{data.locked.map(u => <li key={u.id} className="flex items-center gap-3 py-2 text-sm"><span className="flex-1">{u.name}<span className="ml-2 text-xs text-gray-400">{u.email}</span></span><button onClick={() => unlock(u.id)} className="btn btn-secondary btn-sm" aria-label={`${u.name}のロックを解除`}>解除</button></li>)}</ul>
            </FoldCard>
          )}
          <FoldCard title="ログイン方法（2段階認証・パスキー）" label="ログイン方法" badge={`未設定 ${data.people.filter(p => !p.mfa && p.passkeys === 0).length}人`}>
            <p className="text-xs text-gray-500">パスワードでログインするには2段階認証が必要です。どちらもない人は、次回のログイン時に2段階認証を設定します。</p>
            <ul className="divide-y divide-gray-100">
              {data.people.map(p => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="min-w-32 flex-1">{p.name}<span className="ml-2 text-xs text-gray-400">{p.email}</span></span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${p.mfa ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{p.mfa ? '2段階認証 有効' : '2段階認証 未設定'}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${p.passkeys > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>パスキー {p.passkeys}</span>
                  {p.mfa && <button onClick={() => resetMfa(p.id, p.name)} className="btn btn-secondary btn-sm" aria-label={`${p.name}の2段階認証をリセット`}>リセット</button>}
                </li>
              ))}
            </ul>
          </FoldCard>
        </>
      )}
      <SessionsPanel />
    </div>
  );
}

const TABS = [
  { k: 'overview', l: '概要' },
  { k: 'accounts', l: 'アカウントと端末' },
  { k: 'history', l: 'ログイン履歴' },
  { k: 'access', l: 'アクセスの条件' },
] as const;
type Tab = typeof TABS[number]['k'];

export default function SecurityAdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  // a link such as /admin/security#access opens that tab
  useEffect(() => { const h = window.location.hash.slice(1) as Tab; if (TABS.some(t => t.k === h)) setTab(h); }, []);
  const choose = (k: Tab) => { setTab(k); window.history.replaceState(null, '', `#${k}`); };

  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-bold text-gray-900">セキュリティ</h1><p className="hidden md:block text-xs text-gray-500 mt-0.5">ログインの状況、不審なアクセスの検知、アクセスの条件（システム管理者だけが見られます）</p></div>
      <div role="tablist" aria-label="セキュリティの項目" className="flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(t => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => choose(t.k)}
            className={`shrink-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === t.k ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-800'}`}>{t.l}</button>
        ))}
      </div>
      {/* only the selected tab is on the page, so only its data is asked for */}
      {tab === 'overview' && <OverviewTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'history' && <LoginHistoryPanel />}
      {tab === 'access' && <PolicyPanel />}
    </div>
  );
}
