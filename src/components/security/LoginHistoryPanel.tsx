'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { reasonLabel } from './types';

type Log = { id: string; success: boolean; reason: string | null; ip: string; device: string; place: string | null; network_type: string | null; at: string; email: string; name: string | null };
const when = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const NETWORK: Record<string, string> = { public: '公共', semi_public: '学校/病院', hosting: 'VPN/DC', residential: '自宅/オフィス' };

// ログインの成功・失敗の履歴。メール・IP・場所・組織で探せて、新しい順に50件ずつ読み込む。
export default function LoginHistoryPanel() {
  const [q, setQ] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [rows, setRows] = useState<Log[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0); // an answer to an older search must not replace the newer one

  const load = useCallback(async (query: string, failed: boolean, before?: string) => {
    const my = ++seq.current;
    const sp = new URLSearchParams({ limit: '50' });
    if (query) sp.set('q', query);
    if (failed) sp.set('failed', '1');
    if (before) sp.set('before', before);
    const r = await fetch(`/api/admin/login-logs?${sp}`, { cache: 'no-store' }).catch(() => null);
    if (my !== seq.current) return;
    const d = r?.ok ? await r.json() : { items: [], next: null };
    setRows(cur => (before ? [...(cur ?? []), ...d.items] : d.items));
    setNext(d.next ?? null);
    setMore(false);
  }, []);

  // typing searches after a short pause, not on every key
  useEffect(() => { const t = setTimeout(() => { setRows(null); void load(q, onlyFailed); }, 250); return () => clearTimeout(t); }, [q, onlyFailed, load]);

  return (
    <section aria-label="ログイン履歴" className="card p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" aria-label="履歴を検索" placeholder="メール・IP・組織・場所で検索…" className="input text-sm flex-1 min-w-48 max-w-sm" value={q} onChange={e => setQ(e.target.value)} />
        <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={onlyFailed} onChange={e => setOnlyFailed(e.target.checked)} />失敗だけ</label>
        <button onClick={() => { setRows(null); void load(q, onlyFailed); }} className="btn btn-secondary btn-sm">更新</button>
      </div>
      {rows === null ? <p className="py-8 text-center text-sm text-gray-400">読み込み中…</p>
        : rows.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">ログイン履歴がありません</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs text-gray-500"><tr><th className="py-1.5 text-left">日時</th><th className="py-1.5 text-left">結果</th><th className="py-1.5 text-left">アカウント</th><th className="py-1.5 text-left">アドレス / 場所</th><th className="py-1.5 text-left">端末</th><th className="py-1.5 text-left">ネットワーク</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(l => (
                  <tr key={l.id}>
                    <td className="py-1.5 whitespace-nowrap text-gray-600">{when(l.at)}</td>
                    <td className="py-1.5"><span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${l.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{l.success ? '成功' : `失敗${l.reason ? `（${reasonLabel(l.reason)}）` : ''}`}</span></td>
                    <td className="py-1.5">{l.name ?? <span className="font-mono text-xs text-gray-500">{l.email}</span>}</td>
                    <td className="py-1.5 text-gray-600"><span className="font-mono text-xs">{l.ip}</span> {l.place}</td>
                    <td className="py-1.5 text-gray-500">{l.device}</td>
                    <td className="py-1.5 text-xs text-gray-500">{l.network_type ? NETWORK[l.network_type] ?? l.network_type : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {next && <div className="flex justify-center"><button onClick={() => { setMore(true); void load(q, onlyFailed, next); }} disabled={more} className="btn btn-secondary btn-sm">{more ? '読み込み中…' : 'もっと見る'}</button></div>}
    </section>
  );
}
