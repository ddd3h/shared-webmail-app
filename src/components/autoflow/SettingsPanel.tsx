'use client';
import { useEffect, useState } from 'react';
import { btnPrimary, inp, Notice } from '@/components/work/ui';
import { PREFECTURES } from '@/lib/payroll/tables';

type Config = {
  report: { enabled: boolean };
  expense: { enabled: boolean; days_before: number };
  payment: { enabled: boolean; days_before: number };
  confirm: { enabled: boolean };
  fixed_pay: { enabled: boolean };
  deductions: { enabled: boolean; prefecture: string; timing: 'next' | 'same' };
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
      <Row title="振込の確定の通知" enabled={config.confirm.enabled} onToggle={v => set('confirm', { enabled: v })}>
        <p>「振込」の月次まとめで、経理が「承認して確定」（全銀データの作成）をしたとき、振り込まれる人に「お振込が確定しました」とMattermostのDMで知らせます。振込予定日と項目名だけを載せ、金額と口座は載せません。</p>
        <p>月次まとめでの確定だけが対象です。「作成済みも含める」で作り直したときは、送り直しません。</p>
      </Row>
      <Row title="固定報酬の下書き" enabled={config.fixed_pay.enabled} onToggle={v => set('fixed_pay', { enabled: v })}>
        <p>「固定報酬・賞与」に登録された役員・社員・準業務委託の月額から、毎月の締め日に、給与明細の下書き（支払予定）を自動で作ります。同じ月に二重には作りません。</p>
        <p>控除は、次の「控除の自動計算」をONにしたときだけ入ります。OFFのときは入らないので、下書きの明細で経理が入れてから振込に進んでください。</p>
      </Row>
      <Row title="控除の自動計算" enabled={config.deductions.enabled} onToggle={v => set('deductions', { enabled: v })}>
        <p>固定報酬の下書きに、健康保険・介護保険・子ども・子育て支援金・厚生年金・雇用保険・源泉所得税・住民税を自動で入れます（役員・社員・正社員・パート。派遣と業務委託は対象外）。「控除」のタブで、一人ひとりの生年月日や扶養親族等の数を登録した人だけが対象で、登録がない人は控除なしで警告が付きます。</p>
        <p>協会けんぽの料率・標準報酬月額の等級表と、国税庁の源泉徴収税額表（電算機計算の特例）に基づく概算です。組合健保・厚生年金基金、産休・育休の免除、賞与の控除、年末調整は対象外です。下書きは経理が確かめてから振込に進んでください。</p>
        <label className="flex items-center gap-2">協会けんぽの都道府県
          <select className={inp} value={config.deductions.prefecture} onChange={e => set('deductions', { prefecture: e.target.value })}>
            {PREFECTURES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">社会保険料を引く時期
          <select className={inp} value={config.deductions.timing} onChange={e => set('deductions', { timing: e.target.value as 'next' | 'same' })}>
            <option value="next">翌月徴収（10月分を11月払いの給与から）</option>
            <option value="same">当月徴収（10月分を10月払いの給与から）</option>
          </select>
        </label>
      </Row>
      <Row title="準業務委託の報告書の警告" enabled={config.activity.enabled} onToggle={v => set('activity', { enabled: v })}>
        <p>準業務委託の人が業務報告書を出すとき、報告する日を含む直近の日数にログインの記録がなければ、「虚偽の報告は契約違反」という警告を出して、提出するかどうかを選んでもらいます。提出された報告書には警告の印が付き、経理が分かるようになります。</p>
        <label className="flex items-center gap-2">直近
          <input type="number" min={3} max={60} className={`${inp} w-20`} value={config.activity.days} onChange={e => set('activity', { days: Math.max(3, Math.min(60, Number(e.target.value) || 14)) })} />日間にログインがないとき
        </label>
      </Row>
      <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? '保存中…' : '保存する'}</button>
    </div>
  );
}
