'use client';
import { useEffect, useState } from 'react';
import FoldCard from '@/components/mobile/FoldCard';
import { Notice, api, btnPrimary, inp } from '@/components/work/ui';

// My home address (in the profile). Own-car expense claims are worked out from here to where I went.
export default function HomeAddressSection() {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/profile/home').then(r => r.json()).then(d => { setSaved(d.home_address ?? null); setValue(d.home_address ?? ''); }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const res = await api('/api/profile/home', 'PUT', { home_address: value.trim() || null });
      if (res.ok) { const d = await res.json(); setSaved(d.home_address); setValue(d.home_address ?? ''); setMsg({ type: 'success', text: d.home_address ? '自宅を保存しました' : '自宅を削除しました' }); }
      else setMsg({ type: 'error', text: '保存できませんでした。300文字までです' });
    } finally { setSaving(false); }
  }

  return (
    <FoldCard id="home" title="自宅" label="自宅" badge={loaded ? (saved ? '登録済' : '未登録') : undefined} className="card p-5" bodyClass="space-y-3">
      {!loaded ? <p className="text-sm text-gray-400">読み込み中…</p> : (
        <>
          <p className="text-xs text-gray-500">自家用車で出かけたときの経費（ガソリン代などの走行距離）を、ここから行き先までの往復で計算します。住所は、本人・経理担当・システム管理者だけが見られます。</p>
          <div>
            <label className="text-xs text-gray-600" htmlFor="home-address">自宅の住所</label>
            <input id="home-address" className={inp} placeholder="例: 東京都新宿区西新宿2-8-1" maxLength={300} value={value} onChange={e => setValue(e.target.value)} />
          </div>
          <Notice msg={msg} />
          <div className="flex justify-end"><button className={btnPrimary} disabled={saving || value.trim() === (saved ?? '')} onClick={save}>{saving ? '保存中…' : '自宅を保存'}</button></div>
        </>
      )}
    </FoldCard>
  );
}
