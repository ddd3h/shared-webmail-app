'use client';
import { useEffect, useState } from 'react';
import type { Policy } from './types';
import FoldCard from '@/components/mobile/FoldCard';

// アクセスの条件: どこから使えるか、セッションをどれだけ続けるか、端末の確認。
export default function PolicyPanel() {
  const [p, setP] = useState<Policy | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { fetch('/api/admin/security/policy').then(r => r.json()).then(setP).catch(() => {}); }, []);

  async function save() {
    if (!p) return;
    const res = await fetch('/api/admin/security/policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_cidrs: p.allowed_cidrs, allowed_countries: p.allowed_countries, session_max_days: Number(p.session_max_days), new_device_alert: p.new_device_alert, device_binding: p.device_binding, require_2fa: p.require_2fa, mfa_trust_days: Number(p.mfa_trust_days), block_bots: p.block_bots, remember_days: Number(p.remember_days) }) });
    const e = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: '保存しました' } : { ok: false, text: e.message ?? '保存できませんでした。入力を確認してください' });
  }

  if (!p) return <p className="text-sm text-gray-400">読み込み中…</p>;
  return (
    <FoldCard title="アクセスの条件" label="アクセスの条件" bodyClass="space-y-4">
      <div><p className="text-xs text-gray-500 mt-0.5">いまあなたが使っているアドレス: <span className="font-mono text-gray-700">{p.your_ip}</span></p></div>
      <div>
        <label className="label text-xs">使えるネットワーク（1行に1つ。空なら制限なし）</label>
        <textarea className="input font-mono text-sm" rows={4} placeholder={'203.0.113.7  # 本社\n198.51.100.0/24  # 支社'} value={p.allowed_cidrs} onChange={e => setP({ ...p, allowed_cidrs: e.target.value })} />
        <p className="mt-1 text-xs text-gray-500">設定すると、それ以外のアドレスからはログインも利用もできません。ご自身のアドレスが含まれていないと保存できません。</p>
      </div>
      <div>
        <label className="label text-xs">ログインを許可する国（英語名をカンマ区切り。空なら制限なし）</label>
        <input className="input" placeholder="Japan" value={p.allowed_countries} onChange={e => setP({ ...p, allowed_countries: e.target.value })} />
      </div>
      <div className="rounded-xl border border-gray-200 p-3 space-y-2">
        <label className="flex items-start gap-2 text-sm font-medium text-gray-900"><input type="checkbox" className="mt-1" checked={p.require_2fa} onChange={e => setP({ ...p, require_2fa: e.target.checked })} />ログインは「パスキー」または「パスワード＋2段階認証」だけにする（推奨）</label>
        <p className="text-xs text-gray-500">オフにすると、パスワードだけでログインできてしまいます。2段階認証が未設定の人は、パスワードでのログイン時にその場で設定します。</p>
        <div className="max-w-xs"><label className="label text-xs">「このブラウザを信頼する」の日数（0=使わせない）</label><input className="input" type="number" min={0} max={90} value={p.mfa_trust_days} onChange={e => setP({ ...p, mfa_trust_days: Number(e.target.value) })} /></div>
      </div>
      <div className="rounded-xl border border-gray-200 p-3 space-y-2">
        <div className="max-w-xs"><label className="label text-xs">アプリ（PWA）のログインを維持する日数（0=使わせない）</label><input className="input" type="number" min={0} max={90} value={p.remember_days} onChange={e => setP({ ...p, remember_days: Number(e.target.value) })} /></div>
        <p className="text-xs text-gray-500">ホーム画面に追加したアプリは、最後に使ってからこの日数のあいだ、パスワードなしでログインし直せます（端末ごとの鍵で本人の端末か確認します）。この日数、一度も使わなければログアウトになります。</p>
      </div>
      <div className="rounded-xl border border-gray-200 p-3 space-y-1">
        <label className="flex items-start gap-2 text-sm font-medium text-gray-900"><input type="checkbox" className="mt-1" checked={p.block_bots} onChange={e => setP({ ...p, block_bots: e.target.checked })} />AI・クローラ・スクリプトなどのロボットからの接続を拒否する（推奨）</label>
        <p className="text-xs text-gray-500">ChatGPT・Claude・Google などのAIの収集ロボット、curl・Python・自動操作ブラウザなどを、自己申告（User-Agent）で見分けて断ります。なりすまされると防げないため、IP固定のセッションや2段階認証と併用します。監視ツールなどを通すときは、環境変数 BOT_ALLOW_UA に名前を書きます。</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label text-xs">セッションの最長日数（操作を続けていても、この日数でログアウト）</label><input className="input" type="number" min={1} max={90} value={p.session_max_days} onChange={e => setP({ ...p, session_max_days: Number(e.target.value) })} /></div>
        <div className="space-y-2 pt-5">
          <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={p.new_device_alert} onChange={e => setP({ ...p, new_device_alert: e.target.checked })} />新しい端末からログインしたら本人にMattermostで知らせる</label>
          <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={p.device_binding} onChange={e => setP({ ...p, device_binding: e.target.checked })} />Cookieを別の種類の端末で使われたら、セッションを終了する</label>
        </div>
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`} role="status">{msg.text}</p>}
      <div className="flex justify-end"><button onClick={save} className="btn btn-primary btn-sm">保存</button></div>
    </FoldCard>
  );
}
