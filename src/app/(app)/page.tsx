'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

type Stats = { myAssigned: number; inProgress: number };
type Thread = {
  id: string; subject: string; status: string;
  last_message_at: string; unread_count: number;
  mailbox: { display_name: string };
  assigned_user: { name: string } | null;
};
type User = { name: string; email: string; role: string };
type MailboxStorage = {
  id: string; display_name: string; email_address: string;
  used_bytes: number; max_bytes: number; percent: number;
  cached_at: string | null;
};

const STATUS_CHIP: Record<string, { bg: string; label: string }> = {
  open:        { bg: 'bg-rose-50 text-rose-700 ring-rose-200', label: '未対応' },
  in_progress: { bg: 'bg-blue-50 text-blue-700 ring-blue-200', label: '対応中' },
  waiting:     { bg: 'bg-amber-50 text-amber-700 ring-amber-200', label: '保留' },
  done:        { bg: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: '完了' },
  archived:    { bg: 'bg-gray-100 text-gray-500 ring-gray-200', label: 'アーカイブ' },
};

function formatDate(d: string) {
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}時間前`;
  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}

function formatBytes(b: number) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)}MB`;
  return `${(b / 1024 ** 3).toFixed(2)}GB`;
}

// SVG Pie chart for storage
function StoragePie({ percent }: { percent: number }) {
  const r = 36;
  const cx = 44, cy = 44;
  const circumference = 2 * Math.PI * r;
  const dash = (percent / 100) * circumference;
  const color = percent >= 90 ? '#ef4444' : percent >= 70 ? '#f59e0b' : '#3b82f6';

  return (
    <svg width={88} height={88} viewBox="0 0 88 88" className="flex-shrink-0">
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={10} />
      {/* Progress */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      {/* Percent label */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight={700} fill={color}>
        {percent}%
      </text>
    </svg>
  );
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function DashboardPage() {
  const { data, mutate } = useSWR<{
    user: User; stats: Stats;
    recentTeamThreads: Thread[];
    mailboxStorage: MailboxStorage[];
  }>('/api/dashboard', fetcher);
  const [recalculating, setRecalculating] = useState(false);

  const recalc = async () => {
    setRecalculating(true);
    try {
      await fetch('/api/user/storage-recalc', { method: 'POST' });
      await mutate();
    } finally {
      setRecalculating(false);
    }
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">読み込み中…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">ダッシュボード</h1>
          {data?.user && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-sm text-gray-500 truncate">ようこそ、{data.user.name}さん</span>
              {data.user.role === 'admin' && (
                <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">管理者</span>
              )}
            </div>
          )}
        </div>
        <Link
          href="/threads"
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-semibold shadow-md hover:shadow-lg hover:from-blue-600 hover:to-indigo-700 active:scale-95 transition-all duration-150 px-4 py-2 text-sm whitespace-nowrap flex-shrink-0"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          一覧
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="text-sm font-medium text-gray-500">自分の担当</p>
          <p className="text-3xl font-bold mt-1 text-blue-600">{data?.stats.myAssigned ?? 0}</p>
          <Link href="/threads?view=team&tab=mine" className="text-xs text-blue-500 hover:text-blue-700 mt-2 block">一覧を見る →</Link>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-gray-500">対応中</p>
          <p className="text-3xl font-bold mt-1 text-amber-600">{data?.stats.inProgress ?? 0}</p>
          <Link href="/threads?view=team&tab=in_progress" className="text-xs text-amber-500 hover:text-amber-700 mt-2 block">一覧を見る →</Link>
        </div>
      </div>

      {/* Personal mailbox storage */}
      {data?.mailboxStorage && data.mailboxStorage.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4-8 4s8-1.79 8-4" />
              </svg>
              使用量
            </h2>
            <div className="flex items-center gap-3">
              {data.mailboxStorage[0]?.cached_at && (
                <span className="text-xs text-gray-400">
                  最終更新: {formatDate(data.mailboxStorage[0].cached_at)}
                </span>
              )}
              <button
                onClick={recalc}
                disabled={recalculating}
                className="btn btn-sm text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {recalculating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    計算中…
                  </>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {data.mailboxStorage.map(mb => (
              <div key={mb.id} className="flex items-center gap-4">
                <StoragePie percent={mb.percent} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{mb.display_name}</p>
                  <p className="text-xs text-gray-400 truncate">{mb.email_address}</p>
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{formatBytes(mb.used_bytes)} 使用中</span>
                      <span>{formatBytes(mb.max_bytes)} 最大</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${mb.percent >= 90 ? 'bg-red-500' : mb.percent >= 70 ? 'bg-amber-400' : 'bg-blue-500'}`}
                        style={{ width: `${mb.percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent team threads */}
      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">最近のチームメール</h2>
          <Link href="/threads?type=team" className="text-sm text-blue-600 hover:text-blue-800">すべて見る →</Link>
        </div>
        {!data?.recentTeamThreads?.length ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">
            チームメールはまだありません
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {data.recentTeamThreads.map(t => {
              const chip = STATUS_CHIP[t.status] || STATUS_CHIP.open;
              return (
                <li key={t.id}>
                  <Link href={`/threads/${t.id}`} className="block hover:bg-gray-50 transition-colors">
                    {/* ── モバイルレイアウト (< sm) ── */}
                    <div className="sm:hidden px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`flex-1 min-w-0 truncate text-sm ${t.unread_count > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {t.subject}
                        </span>
                        {t.unread_count > 0 && (
                          <span className="flex-shrink-0 inline-flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold">
                            {t.unread_count}
                          </span>
                        )}
                        <span className="flex-shrink-0 text-xs text-gray-400 tabular-nums">{formatDate(t.last_message_at)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5 gap-3">
                        <p className="text-xs text-gray-500 truncate min-w-0">
                          {t.mailbox.display_name}
                          {t.assigned_user && (
                            <span className="text-blue-600 font-medium"> · {t.assigned_user.name}</span>
                          )}
                        </p>
                        <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${chip.bg}`}>
                          {chip.label}
                        </span>
                      </div>
                    </div>
                    {/* ── PCレイアウト (sm+) — 変更前のレイアウト ── */}
                    <div className="hidden sm:flex items-center gap-4 px-6 py-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 truncate">{t.subject}</span>
                          {t.unread_count > 0 && (
                            <span className="flex-shrink-0 inline-flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold">
                              {t.unread_count}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-gray-500">{t.mailbox.display_name}</span>
                          {t.assigned_user && (
                            <span className="text-xs text-gray-500">担当: {t.assigned_user.name}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${chip.bg}`}>
                          {chip.label}
                        </span>
                        <span className="text-xs text-gray-400">{formatDate(t.last_message_at)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Quick actions */}
      {data?.user.role === 'admin' && (
        <Link href="/admin/settings" className="card p-5 hover:shadow-md transition-shadow flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 text-xl">
            🔧
          </div>
          <div>
            <p className="font-medium text-gray-900">管理設定</p>
            <p className="text-xs text-gray-500 mt-0.5">ユーザー管理・メールアカウント・システム設定</p>
          </div>
        </Link>
      )}
    </div>
  );
}
