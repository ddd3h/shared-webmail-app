'use client';
import { useEffect, useState } from 'react';
import { btnPrimary, inp, Notice } from '@/components/work/ui';

type Config = {
  report: { enabled: boolean };
  expense: { enabled: boolean; days_before: number };
  payment: { enabled: boolean; days_before: number };
  activity: { enabled: boolean; days: number };
};

const Row = ({ title, enabled, onToggle, children }: { title: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
    <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
      <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} aria-label={`${title}を有効にする`} />
      {title}
      <span className={`ml-1 rounded-sm px-1.5 py-0.5 text-[11px] font-normal ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{enabled ? 'ON' : 'OFF'}</span>
    </label>
    <div className="text-xs text-gray-600 space-y-1 pl-6">{children}</div>
  </div>
);

const Days = ({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) => (
  <label className="flex items-center gap-2">{label}
    <input type="number" min={1} max={14} className={`${inp} w-20`} value={value} onChange={e => onChange(Math.max(1, Math.min(14, Number(e.target.value) || 1)))} />日前
  </label>
);

// 流れごとの ON/OFF と日数。最初はすべて OFF。
export default function SettingsPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch('/api/autoflow/config').then(r => r.json()).then(d => setConfig(d.config)).catch(() => {}); }, []);
  if (!config) return <p className="text-sm text-gray-400">読み込み中…</p>;
  const set = <K extends keyof Config>(k: K, v: Partial<Config[K]>) => setConfig({ ...config, [k]: { ...config[k], ...v } });

  async function save() {
    setSaving(true);
    const res = await fetch('/api/autoflow/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
    setSaving(false);
    setMsg(res.ok ? { type: 'success', text: '保存しました。次の通知から反映されます' } : { type: 'error', text: '保存できませんでした' });
    setTimeout(() => setMsg(null), 4000);
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <p className="text-xs text-gray-500">毎日、日本時間の9時以降に1回、期限に合わせてMattermostにDMを送ります（アプリ内の通知にも届きます）。最初はすべてOFFです。「プレビュー」で送る内容を確かめてからONにしてください。</p>
      <Notice msg={msg} />
      <Row title="業務報告書の催促" enabled={config.report.enabled} onToggle={v => set('report', { enabled: v })}>
        <p>業務委託・準業務委託の人へ。締め日の前日、締め日（報酬が支払われない旨）、提出期限日（それでも未提出なら再通知）。</p>
        <p>締め日と提出期限は「勤怠・給与 → 管理 → 締め日・振込日」の設定を使います。</p>
      </Row>
      <Row title="経費の申請期限" enabled={config.expense.enabled} onToggle={v => set('expense', { enabled: v })}>
        <p>承認待ち・差戻し／却下の経費がある人へ。承認待ちは、承認する人にもまとめて知らせます。</p>
        <Days value={config.expense.days_before} onChange={n => set('expense', { days_before: n })} label="申請期限の" /><p>と、期限の当日に送ります。</p>
      </Row>
      <Row title="振込日の準備" enabled={config.payment.enabled} onToggle={v => set('payment', { enabled: v })}>
        <p>経理と管理者へ。振込予定の件数と合計を知らせます（口座の情報は載せません）。</p>
        <Days value={config.payment.days_before} onChange={n => set('payment', { days_before: n })} label="振込日の" /><p>と、振込日の当日に送ります。</p>
      </Row>
      <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? '保存中…' : '保存する'}</button>
    </div>
  );
}
