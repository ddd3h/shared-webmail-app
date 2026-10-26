'use client';
import { useCallback, useEffect, useState } from 'react';
import { RecoveryCodesView, SetupStep } from './TwoFactorParts';

type Status = { enabled: boolean; enabled_at: string | null; recovery_remaining: number; passkeys: number; required: boolean };
type Setup = { qr: string; secret: string; token: string };
type Mode = 'idle' | 'password' | 'setup' | 'codes' | 'regenerate' | 'disable';

const ERRORS: Record<string, string> = {
  wrong_password: 'パスワードが違います', invalid_code: '認証コードが違います', too_many_requests: '試行が多すぎます。しばらくしてからお試しください',
  challenge_expired: '時間切れです。もう一度やり直してください', mfa_not_enabled: '先に2段階認証を設定してください',
};
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// プロフィール: 2段階認証（認証アプリ）の設定・回復コードの再発行・解除。変更のたびにパスワード（と現在のコード）を確認する。
export default function TwoFactorSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const r = await fetch('/api/security/mfa'); if (r.ok) setStatus(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setMode('idle'); setPassword(''); setCode(''); setSetup(null); setError(null); };
  const fail = async (res: Response) => setError(ERRORS[(await res.json().catch(() => ({}))).error] ?? '処理できませんでした');

  async function start(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const res = await post('/api/security/mfa/setup', { password, code: code || undefined });
    setBusy(false);
    if (!res.ok) return fail(res);
    const d = await res.json();
    setSetup({ qr: d.qr, secret: d.secret, token: d.setup_token }); setMode('setup'); setCode('');
  }
  async function confirm(first: string) {
    if (!setup) return;
    setBusy(true); setError(null);
    const res = await post('/api/security/mfa/enable', { setup_token: setup.token, code: first });
    setBusy(false);
    if (!res.ok) return fail(res);
    setCodes((await res.json()).recovery_codes); setMode('codes'); load();
  }
  async function manage(e: React.FormEvent, url: string, after: (d: { recovery_codes?: string[] }) => void) {
    e.preventDefault(); setBusy(true); setError(null);
    const res = await post(url, { password, code });
    setBusy(false);
    if (!res.ok) return fail(res);
    after(await res.json()); load();
  }

  if (!status) return null;
  return (
    <div className="card p-5 space-y-4" aria-label="2段階認証">
      <div>
        <h2 className="font-semibold text-gray-900">2段階認証</h2>
        <p className="text-xs text-gray-500 mt-0.5">パスワードでログインするときに、認証アプリの6桁のコードも入力します。パスキーでのログインには不要です。</p>
      </div>
      {notice && <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800" role="status">{notice}</p>}

      {mode === 'idle' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${status.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{status.enabled ? '有効' : '未設定'}</span>
          {status.enabled && <span className="text-xs text-gray-500">回復コードの残り {status.recovery_remaining} 個{status.recovery_remaining <= 2 ? '（少なくなっています）' : ''}</span>}
          {!status.enabled && status.required && status.passkeys === 0 && <span className="text-xs text-amber-700">未設定のままでも、次回のログイン時に設定を求められます</span>}
          <div className="flex-1" />
          {!status.enabled && <button className="btn btn-primary btn-sm" onClick={() => { setNotice(null); setMode('password'); }}>設定する</button>}
          {status.enabled && <>
            <button className="btn btn-secondary btn-sm" onClick={() => { setNotice(null); setMode('password'); }}>認証アプリを変更</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setNotice(null); setMode('regenerate'); }}>回復コードを再発行</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setNotice(null); setMode('disable'); }}>解除</button>
          </>}
        </div>
      )}

      {(mode === 'password' || mode === 'regenerate' || mode === 'disable') && (
        <form onSubmit={e => mode === 'password' ? start(e) : mode === 'regenerate' ? manage(e, '/api/security/mfa/recovery-codes', d => { setCodes(d.recovery_codes ?? []); setMode('codes'); }) : manage(e, '/api/security/mfa/disable', () => { reset(); setNotice('2段階認証を解除しました。他の端末はログアウトされました'); })} className="space-y-3 max-w-sm">
          <p className="text-sm text-gray-600">{mode === 'disable' ? '解除すると、パスワードでログインするには設定し直す必要があります。' : '本人確認のため、パスワードを入力してください。'}</p>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700" role="alert">{error}</div>}
          <div><label className="label" htmlFor="mfa-pw">パスワード</label><input id="mfa-pw" type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></div>
          {status.enabled && <div><label className="label" htmlFor="mfa-cur">現在の認証コード（または回復コード）</label><input id="mfa-cur" className="input" value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" required /></div>}
          <div className="flex gap-2"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? '確認中…' : mode === 'disable' ? '解除する' : '次へ'}</button><button type="button" className="btn btn-secondary btn-sm" onClick={reset}>キャンセル</button></div>
        </form>
      )}

      {mode === 'setup' && setup && <div className="max-w-sm"><SetupStep qr={setup.qr} secret={setup.secret} onSubmit={confirm} onCancel={reset} busy={busy} error={error} /></div>}
      {mode === 'codes' && <div className="max-w-sm"><RecoveryCodesView codes={codes} doneLabel="完了" onDone={() => { reset(); setNotice('保存しました'); }} /></div>}
    </div>
  );
}
