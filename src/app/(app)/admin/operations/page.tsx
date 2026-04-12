'use client';
import { useEffect, useState } from 'react';

type SyncState = {
  mailbox_id: string;
  mailbox_name: string;
  mailbox_email: string;
  status: string;
  last_sync_started_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_test_status: string | null;
  last_tested_at: string | null;
};

type NotifFail = {
  id: string;
  channel: string;
  status: string;
  error_message: string | null;
  created_at: string;
  event: { title: string; priority: string } | null;
};

type AuditLog = {
  id: string;
  actor_user_id: string | null;
  action_type: string;
  target_type: string;
  target_id: string | null;
  metadata_json: string;
  created_at: string;
  actor?: { name: string; email: string } | null;
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === 'idle' || status === 'success' ? 'bg-emerald-400' :
    status === 'running' ? 'bg-blue-400 animate-pulse' :
    status === 'error' || status === 'failed' ? 'bg-red-400' :
    'bg-gray-300';
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

export default function OperationsPage() {
  const [syncs, setSyncs] = useState<SyncState[]>([]);
  const [notifFails, setNotifFails] = useState<NotifFail[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [tab, setTab] = useState<'sync' | 'notif' | 'audit'>('sync');
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    const [cRes, nRes, aRes] = await Promise.all([
      fetch('/api/admin/connection-errors').then((r) => r.json()),
      fetch('/api/admin/notification-errors').then((r) => r.json()),
      fetch('/api/admin/audit-logs').then((r) => r.json())
    ]);
    setSyncs(cRes.items || []);
    setNotifFails(nRes.items || []);
    setLogs(aRes.items || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function searchLogs() {
    const res = await fetch(`/api/admin/audit-logs?q=${encodeURIComponent(logSearch)}`);
    const data = await res.json();
    setLogs(data.items || []);
  }

  async function retryNotif(id: string) {
    setRetrying((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/admin/notification-errors/${id}/retry`, { method: 'POST' });
      await load();
    } finally {
      setRetrying((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }

  const tabs = [
    { id: 'sync', label: '同期・接続状態', count: syncs.filter((s) => s.status === 'error').length },
    { id: 'notif', label: '通知失敗', count: notifFails.length },
    { id: 'audit', label: '監査ログ', count: null }
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">運用状況</h1>
          <p className="text-sm text-gray-500 mt-0.5">同期エラー・通知失敗・監査ログを確認します</p>
        </div>
        <button onClick={load} className="btn-secondary btn-sm">更新</button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {t.count !== null && t.count > 0 && (
                <span className="badge bg-red-100 text-red-600 text-xs">{t.count}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-sm text-gray-400">読み込み中…</div>
      ) : (
        <>
          {/* Sync tab */}
          {tab === 'sync' && (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-500">メールアカウント</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">同期状態</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">最終成功</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">接続テスト</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">エラー</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {syncs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">データなし</td>
                    </tr>
                  ) : syncs.map((s) => (
                    <tr key={s.mailbox_id} className={s.status === 'error' ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{s.mailbox_name}</p>
                        <p className="text-xs text-gray-400">{s.mailbox_email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusDot status={s.status} />
                          <span className="text-gray-700">{s.status}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(s.last_sync_started_at)}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(s.last_success_at)}</td>
                      <td className="px-4 py-3">
                        {s.last_test_status ? (
                          <span className={`badge ${s.last_test_status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                            {s.last_test_status}
                          </span>
                        ) : <span className="text-gray-300">未テスト</span>}
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(s.last_tested_at)}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-red-600 max-w-xs truncate" title={s.last_error || ''}>
                        {s.last_error || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Notification fails tab */}
          {tab === 'notif' && (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-500">通知タイトル</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">チャンネル</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">エラー</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">日時</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {notifFails.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">通知失敗なし</td>
                    </tr>
                  ) : notifFails.map((f) => (
                    <tr key={f.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">{f.event?.title || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{f.channel}</td>
                      <td className="px-4 py-3 text-xs text-red-600 max-w-xs truncate">{f.error_message || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(f.created_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => retryNotif(f.id)}
                          disabled={retrying.has(f.id)}
                          className="btn-secondary btn-sm"
                        >
                          {retrying.has(f.id) ? '再試行中…' : '再試行'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Audit log tab */}
          {tab === 'audit' && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <input
                  type="search"
                  placeholder="操作タイプや対象IDで検索…"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchLogs()}
                  className="input flex-1"
                />
                <button onClick={searchLogs} className="btn-primary btn-sm">検索</button>
              </div>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">操作者</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">操作</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">対象</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">日時</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-400">ログなし</td>
                      </tr>
                    ) : logs.map((l) => (
                      <tr key={l.id}>
                        <td className="px-4 py-3 text-gray-700">{l.actor?.name || l.actor_user_id || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="badge bg-gray-100 text-gray-600 font-mono text-xs">{l.action_type}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {l.target_type}{l.target_id ? ` / ${l.target_id.slice(0, 8)}…` : ''}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">{formatDate(l.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
