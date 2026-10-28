'use client';
import { useState } from 'react';
import type { Overview } from './types';
import FoldCard from '@/components/mobile/FoldCard';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '解除するまで');

// ブロック中のアドレス。自動ブロック（スイーピング検知）も手動ブロックも、ここから解除できる。
export default function BlocksPanel({ blocks, onChanged }: { blocks: Overview['blocks']; onChanged: () => void }) {
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    const res = await fetch('/api/admin/security/blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip, reason, minutes: minutes ? Number(minutes) : null }) });
    const e = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: 'ブロックしました' } : { ok: false, text: e.message ?? 'アドレスの書式を確認してください（例: 203.0.113.7 または 203.0.113.0/24）' });
    if (res.ok) { setIp(''); setReason(''); setMinutes(''); onChanged(); }
  }
  async function lift(id: string) {
    await fetch(`/api/admin/security/blocks/${id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <FoldCard title="ブロック中のアドレス" label="ブロック中のアドレス" badge={`${blocks.length}件`} bodyClass="space-y-3">
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`} role="status">{msg.text}</p>}
      {blocks.length === 0 ? <p className="text-sm text-gray-400">ブロック中のアドレスはありません</p> : (
        <ul className="divide-y divide-gray-100">
          {blocks.map(b => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="font-mono text-gray-900">{b.ip}</span>
              <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${b.source === 'auto' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{b.source === 'auto' ? '自動' : '手動'}</span>
              <span className="min-w-40 flex-1 text-xs text-gray-500">{b.reason}</span>
              <span className="text-xs text-gray-400">{b.expires_at ? `${when(b.expires_at)} まで` : '解除するまで'}</span>
              <button onClick={() => lift(b.id)} className="btn btn-secondary btn-sm" aria-label={`${b.ip}のブロックを解除`}>解除</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto] items-end border-t border-gray-100 pt-3">
        <div><label className="label text-xs">アドレス / 範囲</label><input className="input" placeholder="203.0.113.7 または 203.0.113.0/24" value={ip} onChange={e => setIp(e.target.value)} /></div>
        <div><label className="label text-xs">理由</label><input className="input" value={reason} onChange={e => setReason(e.target.value)} /></div>
        <div><label className="label text-xs">分（空=無期限）</label><input className="input" type="number" min={1} value={minutes} onChange={e => setMinutes(e.target.value)} /></div>
        <button onClick={add} disabled={!ip.trim() || !reason.trim()} className="btn btn-primary btn-sm">ブロック</button>
      </div>
    </FoldCard>
  );
}
