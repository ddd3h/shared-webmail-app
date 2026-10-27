'use client';
import { useEffect, useState } from 'react';
import FoldCard from '@/components/mobile/FoldCard';

type Provider = 'google' | 'osm' | 'manual';
type Status = { rate_per_km: number; maps_api_key_set: boolean; route_provider: Provider; osrm_url: string | null };

const OPTIONS: { value: Provider; label: string; help: string }[] = [
  { value: 'osm', label: 'OpenStreetMap（無料・キー不要）', help: '住所は国土地理院の住所検索（施設名はOpenStreetMap）、ルートはOpenStreetMapの道路データで調べます。公開サーバーは、1日に数十件ほどの社内利用を想定した無料サービスです。' },
  { value: 'google', label: 'Googleマップ（有料・APIキーが必要）', help: 'Googleの最適ルートで調べます。Google Cloudで「Routes API」を有効にしたキーが必要で、使った分だけ料金がかかります。' },
  { value: 'manual', label: '調べない（申請者が片道の距離を入力）', help: '地図は使わず、申請者が片道の距離（km）を自分で入力します。承認者は地図のリンクで確かめます。' },
];

// 経費（自家用車）: the rate per km, and how the distance is found. Saved on its own, apart from the sticky save bar of the other settings.
export default function MileageSettingsCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [rate, setRate] = useState('');
  const [key, setKey] = useState('');
  const [osrm, setOsrm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const d: Status | null = await fetch('/api/admin/expense-settings').then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!d) return;
    setSt(d); setRate(String(d.rate_per_km)); setOsrm(d.osrm_url ?? '');
  }
  useEffect(() => { load(); }, []);

  async function save(body: Record<string, unknown>, done: string) {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/expense-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const e = await res.json().catch(() => ({}));
      if (res.ok) { setMsg({ ok: true, text: done }); if (typeof body.maps_api_key === 'string') setKey(''); await load(); }
      else setMsg({ ok: false, text: e.error === 'key_required' ? 'Googleマップを使うには、先にAPIキーを保存してください' : '保存できませんでした。入力を確認してください（単価は1〜1000の整数、サーバーのアドレスは http(s):// で始めます）' });
    } finally { setSaving(false); }
  }

  if (!st) return null;
  return (
    <FoldCard title="経費（自家用車）" label="経費（自家用車）" className="card p-6" bodyClass="">
      <div className="space-y-5">
        <div className="max-w-xs">
          <label className="label" htmlFor="mileage-rate">1kmあたりの単価（円）</label>
          <div className="flex gap-2">
            <input id="mileage-rate" type="number" min={1} max={1000} className="input" value={rate} onChange={e => setRate(e.target.value)} />
            <button type="button" className="btn btn-primary whitespace-nowrap" disabled={saving || !rate} onClick={() => save({ rate_per_km: Number(rate) }, '単価を保存しました')}>保存</button>
          </div>
          <p className="text-xs text-gray-400 mt-1">自宅から行き先までの往復距離にこの単価をかけた額が、自家用車の経費になります。変更は、これから申請する分に反映されます（申請済みの金額は変わりません）。</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="label">距離の調べ方</legend>
          {OPTIONS.map(o => (
            <label key={o.value} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${st.route_provider === o.value ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200'}`}>
              <input type="radio" name="route-provider" className="mt-1" checked={st.route_provider === o.value} disabled={saving}
                onChange={() => save({ route_provider: o.value }, `距離の調べ方を「${o.label.split('（')[0]}」にしました`)} />
              <span><span className="font-medium text-gray-900">{o.label}</span><span className="block text-xs text-gray-500">{o.help}</span></span>
            </label>
          ))}
        </fieldset>

        {st.route_provider === 'osm' && (
          <div className="max-w-xl">
            <label className="label" htmlFor="osrm-url">ルート検索サーバーのアドレス（任意）</label>
            <div className="flex gap-2">
              <input id="osrm-url" className="input font-mono text-xs" value={osrm} onChange={e => setOsrm(e.target.value)} placeholder="空欄なら公開サーバー（router.project-osrm.org）" />
              <button type="button" className="btn btn-primary whitespace-nowrap" disabled={saving} onClick={() => save({ osrm_url: osrm.trim() }, osrm.trim() ? 'サーバーのアドレスを保存しました' : '公開サーバーに戻しました')}>保存</button>
            </div>
            <p className="text-xs text-gray-400 mt-1">件数が増えたときは、自分で立てたOSRMサーバー（日本のOpenStreetMapデータ）のアドレスを入れると、公開サーバーに頼らずに済みます。</p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="maps-key">Google Maps APIキー（Routes API）</label>
          <div className="flex gap-2">
            <input id="maps-key" type="password" autoComplete="off" className="input font-mono text-xs" value={key} onChange={e => setKey(e.target.value)} placeholder={st.maps_api_key_set ? '設定済み（変更するときだけ入力）' : 'AIza…（Googleマップを使うときだけ）'} />
            <button type="button" className="btn btn-primary whitespace-nowrap" disabled={saving || !key.trim()} onClick={() => save({ maps_api_key: key.trim() }, 'APIキーを保存しました')}>保存</button>
            {st.maps_api_key_set && <button type="button" className="btn whitespace-nowrap" disabled={saving} onClick={() => { if (confirm('APIキーを削除しますか？ Googleマップは使えなくなります')) void save({ maps_api_key: '' }, 'APIキーを削除しました'); }}>削除</button>}
          </div>
          <p className="text-xs text-gray-400 mt-1">{st.maps_api_key_set ? 'キーは設定済みです。' : 'キーは未設定です。'}Googleマップは、上で選んでいるときだけ使います。</p>
        </div>
        {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      </div>
    </FoldCard>
  );
}
