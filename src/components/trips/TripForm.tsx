'use client';
import { useState } from 'react';
import { Modal, btn, btnPrimary, inp } from '@/components/work/ui';
import { AllowancePicker, type RateType, type Trip } from './shared';

export type TripDraft = { id?: string; destination: string; purpose: string; start_date: string; end_date: string; daily: string; addons: string[] };

export function draftFromTrip(t: Trip): TripDraft {
  return {
    id: t.id, destination: t.destination, purpose: t.purpose, start_date: t.start_date, end_date: t.end_date,
    daily: t.allowances.find(l => l.kind === 'daily')?.type_id ?? '', addons: t.allowances.filter(l => l.kind === 'addon' && l.type_id).map(l => l.type_id!),
  };
}

const ERRORS: Record<string, string> = {
  overlap: 'その期間は、すでに申請している別の出張と重なっています',
  invalid_dates: '期間が正しくありません（終了日は開始日以降、90日以内）',
  invalid_allowance: '選べない手当が含まれています。画面を開き直してください',
  multiple_daily: '日当は1つしか選べません',
};

// New / edit request. With `allowancesOnly` (admin adjusting) only the 日当・加算金 can be changed.
export default function TripForm({ initial, types, allowancesOnly = false, resubmit = false, onClose, onSaved }: {
  initial: TripDraft; types: RateType[]; allowancesOnly?: boolean; resubmit?: boolean; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  async function save() {
    setSaving(true); setError('');
    try {
      const body = { destination: d.destination, purpose: d.purpose, start_date: d.start_date, end_date: d.end_date, daily_type_id: d.daily || null, addon_type_ids: d.addons };
      const res = await fetch(d.id ? `/api/trips/${d.id}` : '/api/trips', {
        method: d.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) { onSaved(allowancesOnly ? '手当を更新しました' : d.id ? (resubmit ? '再申請しました' : '申請を更新しました') : '出張を申請しました'); return; }
      const e = await res.json().catch(() => ({}));
      setError(ERRORS[e.error] ?? '保存に失敗しました。入力内容を確認してください');
    } finally { setSaving(false); }
  }

  const title = allowancesOnly ? '手当を調整' : d.id ? (resubmit ? '修正して再申請' : '出張申請を編集') : '出張を申請';
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        {allowancesOnly ? (
          <p className="text-sm text-gray-700">{d.destination}（{d.start_date} 〜 {d.end_date}）の日当・加算金を調整します。日付や行き先は変更できません。</p>
        ) : (
          <>
            <div><label className="text-xs text-gray-600">出張先</label><input className={inp} placeholder="例: 名古屋（A社 本社）" value={d.destination} onChange={e => setD({ ...d, destination: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-600">出発日</label><input type="date" className={inp} value={d.start_date} onChange={e => setD({ ...d, start_date: e.target.value, end_date: d.end_date < e.target.value ? e.target.value : d.end_date })} /></div>
              <div><label className="text-xs text-gray-600">帰着日</label><input type="date" className={inp} min={d.start_date} value={d.end_date} onChange={e => setD({ ...d, end_date: e.target.value })} /></div>
            </div>
            {d.start_date && d.start_date < today && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">出発日が過ぎています（事後申請になります）。</p>}
            <div><label className="text-xs text-gray-600">業務内容・目的</label><textarea className={inp} rows={3} placeholder="例: A社 システム導入の立ち会い、現地での設定作業" value={d.purpose} onChange={e => setD({ ...d, purpose: e.target.value })} /></div>
          </>
        )}
        <AllowancePicker types={types} daily={d.daily} addons={d.addons} start={d.start_date} end={d.end_date} onChange={v => setD({ ...d, daily: v.daily, addons: v.addons })} />
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button className={btn} onClick={onClose}>閉じる</button>
        <button className={btnPrimary} disabled={saving || (!allowancesOnly && (!d.destination.trim() || !d.purpose.trim() || !d.start_date || !d.end_date))} onClick={save}>
          {saving ? '送信中…' : allowancesOnly ? '手当を更新' : d.id ? (resubmit ? '再申請する' : '更新する') : '申請する'}
        </button>
      </div>
    </Modal>
  );
}
