'use client';
import type { ReactNode } from 'react';

export type WorkerType = 'executive' | 'employee' | 'contractor';
export const TYPE_LABEL: Record<WorkerType, string> = { executive: '役員', employee: '従業員', contractor: '業務委託' };

export const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';
export const btn = 'rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50';
export const btnPrimary = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';

export const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

// 450 -> "7:30"
export function fmtMin(m: number | null) {
  if (m === null || m === undefined) return '–';
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

const JST = 'Asia/Tokyo';
export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { timeZone: JST, hour: '2-digit', minute: '2-digit' }) : '–';

// ISO instant <-> "YYYY-MM-DDTHH:mm" in Japan time (for datetime-local inputs)
export const toJstInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16) : '');
export const fromJstInput = (v: string) => (v ? new Date(`${v}:00+09:00`).toISOString() : null);

export const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
export function dateLabel(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）`;
}

export function currentMonth() {
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.toISOString().slice(0, 7);
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(shiftMonth(month, -1))} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" aria-label="前の月">‹</button>
      <div className="text-base font-semibold text-gray-900 min-w-28 text-center">{month.slice(0, 4)}年{Number(month.slice(5))}月</div>
      <button onClick={() => onChange(shiftMonth(month, 1))} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" aria-label="次の月">›</button>
      <button onClick={() => onChange(currentMonth())} className="ml-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm">今月</button>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2.5 sm:p-3">
      <div className="text-[11px] sm:text-xs text-gray-500 leading-tight">{label}</div>
      <div className="text-base sm:text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="hidden sm:block text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-70 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className="w-full md:max-w-xl max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 md:hidden" />
        <h3 className="text-base font-semibold text-gray-900 mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Notice({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  return <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.text}</div>;
}

export async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return res;
}
