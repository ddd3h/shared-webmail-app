'use client';
import { useState } from 'react';

// Pieces of the two-factor screens shared by the login page and the profile page.

/** The 6 digits from the authenticator app (or a recovery code). */
export function CodeStep({ onSubmit, onCancel, trustDays, busy, error }: { onSubmit: (code: string, trust: boolean) => void; onCancel: () => void; trustDays: number; busy: boolean; error: string | null }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [trust, setTrust] = useState(false);
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(code, trust && !recovery); }} className="space-y-4">
      <p className="text-sm text-gray-600">{recovery ? '保存してある回復コードを1つ入力してください。' : '認証アプリに表示されている6桁のコードを入力してください。'}</p>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700" role="alert">{error}</div>}
      <div>
        <label className="label" htmlFor="mfa-code">{recovery ? '回復コード' : '認証コード'}</label>
        <input
          id="mfa-code" className="input tracking-widest text-center text-lg" value={code} onChange={e => setCode(e.target.value)} autoFocus required
          inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 20 : 8} placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
        />
      </div>
      {trustDays > 0 && !recovery && (
        <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={trust} onChange={e => setTrust(e.target.checked)} />このブラウザを{trustDays}日間信頼する（その間はコードを省略）</label>
      )}
      <button type="submit" className="btn btn-primary w-full justify-center py-2.5" disabled={busy || !code.trim()}>{busy ? '確認中…' : '確認する'}</button>
      <div className="flex justify-between text-xs">
        <button type="button" className="text-blue-600 hover:underline" onClick={() => { setRecovery(r => !r); setCode(''); }}>{recovery ? '認証アプリのコードを使う' : '回復コードを使う'}</button>
        <button type="button" className="text-gray-500 hover:underline" onClick={onCancel}>最初に戻る</button>
      </div>
    </form>
  );
}

/** Scan the QR code (or type the key), then type the first code to prove it works. */
export function SetupStep({ qr, secret, onSubmit, onCancel, busy, error }: { qr: string; secret: string; onSubmit: (code: string) => void; onCancel: () => void; busy: boolean; error: string | null }) {
  const [code, setCode] = useState('');
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(code); }} className="space-y-4">
      <p className="text-sm text-gray-600">認証アプリ（Google Authenticator・Microsoft Authenticator・1Password など）で、次のQRコードを読み取ってください。</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="2段階認証の設定用QRコード" width={220} height={220} className="mx-auto rounded-lg border border-gray-200" />
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">QRコードを読み取れないとき</summary>
        <p className="mt-1">アプリに次のキーを手入力してください（時間ベース）。</p>
        <code className="mt-1 block break-all rounded bg-gray-50 px-2 py-1.5 font-mono text-sm text-gray-800" aria-label="設定キー">{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
      </details>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700" role="alert">{error}</div>}
      <div>
        <label className="label" htmlFor="mfa-setup-code">アプリに表示された6桁のコード</label>
        <input id="mfa-setup-code" className="input tracking-widest text-center text-lg" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" required />
      </div>
      <button type="submit" className="btn btn-primary w-full justify-center py-2.5" disabled={busy || !code.trim()}>{busy ? '確認中…' : '有効にする'}</button>
      <button type="button" className="w-full text-center text-xs text-gray-500 hover:underline" onClick={onCancel}>キャンセル</button>
    </form>
  );
}

/** The recovery codes, shown once. The person has to say they saved them before going on. */
export function RecoveryCodesView({ codes, onDone, doneLabel = '続ける' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  function download() {
    const url = URL.createObjectURL(new Blob([`共有メールワークスペース 回復コード\n（1つにつき1回だけ使えます）\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = 'recovery-codes.txt'; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700"><b>回復コードを保存してください。</b>スマートフォンを失くしたときに、コード1つにつき1回だけログインに使えます。この画面を閉じると二度と表示されません。</p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 font-mono text-sm" aria-label="回復コード">{codes.map(c => <li key={c}>{c}</li>)}</ul>
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => {}); setCopied(true); }}>{copied ? 'コピーしました' : 'コピー'}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={download}>ファイルに保存</button>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={saved} onChange={e => setSaved(e.target.checked)} />回復コードを安全な場所に保存しました</label>
      <button type="button" className="btn btn-primary w-full justify-center py-2.5" disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}
