'use client';
import { useEffect, useState } from 'react';
import FoldCard from '@/components/mobile/FoldCard';

// 経費（自家用車）: the rate per km, and the Google Maps key used to search the route. Saved on its own, apart from the sticky save bar of the other settings.
export default function MileageSettingsCard() {
  const [rate, setRate] = useState('');
  const [keySet, setKeySet] = useState(false);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/expense-settings').then(r => r.json()).then(d => { setRate(String(d.rate_per_km)); setKeySet(!!d.maps_api_key_set); }).catch(() => {});
  }, []);

  async function save(body: Record<string, unknown>, done: string) {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/expense-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        setMsg({ ok: true, text: done });
        if (typeof body.maps_api_key === 'string') { setKeySet(body.maps_api_key !== ''); setKey(''); }
      } else setMsg({ ok: false, text: '保存できませんでした。単価は1〜1000の整数で入力してください' });
    } finally { setSaving(false); }
  }

  return (
    <FoldCard title="経費（自家用車）" label="経費（自家用車）" className="card p-6" bodyClass="">
      <div className="space-y-4">
        <div className="max-w-xs">
          <label className="label" htmlFor="mileage-rate">1kmあたりの単価（円）</label>
          <div className="flex gap-2">
            <input id="mileage-rate" type="number" min={1} max={1000} className="input" value={rate} onChange={e => setRate(e.target.value)} />
            <button type="button" className="btn btn-primary whitespace-nowrap" disabled={saving || !rate} onClick={() => save({ rate_per_km: Number(rate) }, '単価を保存しました')}>保存</button>
          </div>
          <p className="text-xs text-gray-400 mt-1">自宅から行き先までの往復距離にこの単価をかけた額が、自家用車の経費になります。変更は、これから申請する分に反映されます（申請済みの金額は変わりません）。</p>
        </div>
        <div>
          <label className="label" htmlFor="maps-key">Google Maps APIキー（Routes API）</label>
          <div className="flex gap-2">
            <input id="maps-key" type="password" autoComplete="off" className="input font-mono text-xs" value={key} onChange={e => setKey(e.target.value)} placeholder={keySet ? '設定済み（変更するときだけ入力）' : 'AIza…'} />
            <button type="button" className="btn btn-primary whitespace-nowrap" disabled={saving || !key.trim()} onClick={() => save({ maps_api_key: key.trim() }, 'APIキーを保存しました')}>保存</button>
            {keySet && <button type="button" className="btn whitespace-nowrap" disabled={saving} onClick={() => { if (confirm('APIキーを削除しますか？ 削除すると、距離を申請者が自分で入力する方式になります')) void save({ maps_api_key: '' }, 'APIキーを削除しました'); }}>削除</button>}
          </div>
          <p className="text-xs text-gray-400 mt-1">{keySet ? '設定済みです。申請のたびに、Googleマップの最適ルートで距離を自動計算します。' : '未設定です。設定すると距離を自動で計算します。未設定のあいだは、申請者が片道の距離を自分で入力します。'}（Google Cloudで「Routes API」を有効にしたキーが必要です）</p>
        </div>
        {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      </div>
    </FoldCard>
  );
}
