'use client';
import { useCallback, useEffect, useState } from 'react';
import { reasonLabel } from './types';

type Sess = { id: string; ip: string; device: string; place: string | null; network_type: string; last_activity_at: string; created_at: string; current: boolean };
type Login = { id: string; success: boolean; reason: string | null; ip: string; device: string; place: string | null; at: string };

const NETWORK: Record<string, string> = { residential: '', public: '公共のネットワーク', semi_public: '学校・病院などのネットワーク', hosting: 'クラウド・VPN経由' };
const when = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// プロフィール: いまログインしている端末と、最近のログイン履歴。心当たりのない端末は、ここから終了できる。
export default function SecuritySection() {
  const [sessions, setSessions] = useState<Sess[] | null>(null);
  const [history, setHistory] = useState<Login[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([fetch('/api/security/sessions'), fetch('/api/security/login-history')]);
    if (s.ok) setSessions((await s.json()).items);
    if (h.ok) setHistory((await h.json()).items);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function end(id: string) {
    const res = await fetch(`/api/security/sessions/${id}`, { method: 'DELETE' });
    setMsg(res.ok ? '端末のログインを終了しました' : '終了できませんでした');
    load();
  }
  async function endOthers() {
    if (!confirm('今使っている端末以外のログインをすべて終了します。よろしいですか？')) return;
    const res = await fetch('/api/security/sessions', { method: 'DELETE' });
    setMsg(res.ok ? `${(await res.json()).ended}件の端末のログインを終了しました` : '終了できませんでした');
    load();
  }

  const others = (sessions ?? []).filter(s => !s.current).length;
  return (
    <div className="card p-5 space-y-5" aria-label="セキュリティ">
      <div>
        <h2 className="font-semibold text-gray-900">ログイン中の端末</h2>
        <p className="text-xs text-gray-500 mt-0.5">いま、あなたのアカウントにログインしている端末です。心当たりのない端末があれば終了し、パスワードを変更してください。</p>
      </div>
      {msg && <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800" role="status">{msg}</p>}
      {sessions === null ? <p className="text-sm text-gray-400">読み込み中…</p> : (
        <ul className="space-y-2">
          {sessions.map(s => (
            <li key={s.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 ${s.current ? 'border-blue-200 bg-blue-50/50' : 'border-gray-200'}`}>
              <div className="min-w-48 flex-1">
                <div className="text-sm font-medium text-gray-900">{s.device}{s.current && <span className="ml-2 rounded-sm bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">この端末</span>}</div>
                <div className="text-xs text-gray-500">{s.place ?? '場所不明'} ・ {s.ip}{NETWORK[s.network_type] ? ` ・ ${NETWORK[s.network_type]}` : ''}</div>
                <div className="text-xs text-gray-400">最後の操作 {when(s.last_activity_at)} ・ ログイン {when(s.created_at)}</div>
              </div>
              {!s.current && <button onClick={() => end(s.id)} className="btn btn-secondary btn-sm">終了</button>}
            </li>
          ))}
        </ul>
      )}
      {others > 0 && <button onClick={endOthers} className="btn btn-secondary btn-sm">他の{others}台をすべてログアウト</button>}

      <div className="border-t border-gray-100 pt-4">
        <h2 className="font-semibold text-gray-900">最近のログイン履歴</h2>
        <p className="text-xs text-gray-500 mt-0.5 mb-2">あなたのアカウントへのログイン（失敗した試行を含む）です。</p>
        {history === null ? <p className="text-sm text-gray-400">読み込み中…</p> : history.length === 0 ? <p className="text-sm text-gray-400">履歴はありません</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {history.map(l => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${l.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{l.success ? '成功' : '失敗'}</span>
                <span className="text-gray-700">{when(l.at)}</span>
                <span className="text-gray-500">{l.device}</span>
                <span className="text-gray-400">{l.place ?? '場所不明'} ・ {l.ip}</span>
                {!l.success && l.reason && <span className="text-xs text-red-600">{reasonLabel(l.reason)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
