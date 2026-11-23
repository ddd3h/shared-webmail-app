'use client';
import { useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';

// The address of the connection changed inside a session (see lib/address-confirm.ts): the person proves who they are again, the way they log in
// (the passkey, or the password and the code), and goes on where they were. Used in the dialog of SessionGuard and on the /confirm-address page.
export type AddressResult = 'ok' | 'ended';

type Info = { needed: boolean; method: 'passkey' | 'password' | 'none'; code: boolean };

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500';
const ERRORS: Record<string, string> = {
  wrong_password: 'パスワードが違います',
  invalid_code: '認証コードが違います（認証アプリの6桁の数字）。ログインで使ったばかりのコードは使えないので、次のコードに変わってから入れてください',
  passkey_failed: 'パスキーで確認できませんでした。このアカウントのパスキーを使ってください',
  challenge_expired: '時間がたちすぎました。もう一度お試しください',
  too_many_requests: '試行が多すぎます。しばらくしてからお試しください',
};

export default function AddressCheck({ onDone }: { onDone: (r: AddressResult) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const onDone = (r: AddressResult) => doneRef.current(r);
    let alive = true;
    fetch('/api/auth/confirm-address', { cache: 'no-store' })
      .then(async res => {
        if (!alive) return;
        if (res.status === 401) { onDone('ended'); return; }
        const d = (await res.json()) as Info;
        if (!d.needed) { onDone('ok'); return; }
        setInfo(d);
      })
      .catch(() => { if (alive) setError('確認の準備ができませんでした。通信の状態を確かめて、ページを開き直してください'); });
    return () => { alive = false; };
  }, []);

  async function send(body: Record<string, unknown>) {
    const res = await fetch('/api/auth/confirm-address', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { onDone('ok'); return; }
    if (res.status === 401) { onDone('ended'); return; }
    const d = await res.json().catch(() => ({}));
    setError(ERRORS[d.error] ?? '確認できませんでした');
  }

  async function withPasskey() {
    setBusy(true); setError('');
    try {
      const opt = await fetch('/api/auth/confirm-address/options', { method: 'POST' });
      if (opt.status === 401) { onDone('ended'); return; }
      if (!opt.ok) { const d = await opt.json().catch(() => ({})); setError(ERRORS[d.error] ?? '確認の準備ができませんでした'); return; }
      let answer;
      try { answer = await startAuthentication({ optionsJSON: await opt.json() }); }
      catch (e) { setError((e as { name?: string })?.name === 'NotAllowedError' ? 'パスキーでの確認がキャンセルされました' : 'パスキーで確認できませんでした'); return; }
      await send({ passkey: answer });
    } catch { setError('通信できませんでした。もう一度お試しください'); } finally { setBusy(false); }
  }

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await send({ password, ...(code ? { code } : {}) }); } catch { setError('通信できませんでした。もう一度お試しください'); } finally { setBusy(false); }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/login');
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">インターネットの接続元（IPアドレス）が変わりました。安全のため、続ける前に本人であることを確かめます。確かめると、新しい接続元からもそのまま使えます。</p>
      {!info && !error && <p className="text-sm text-gray-400">準備しています…</p>}
      {info?.method === 'passkey' && (
        <button type="button" onClick={withPasskey} disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? '確認しています…' : 'パスキーで確認する'}
        </button>
      )}
      {info?.method === 'password' && (
        <form onSubmit={withPassword} className="space-y-3">
          <input className={inp} type="password" autoComplete="current-password" autoFocus aria-label="パスワード" placeholder="パスワード" value={password} onChange={e => setPassword(e.target.value)} />
          {info.code && <input className={inp} inputMode="numeric" autoComplete="one-time-code" aria-label="認証コード" placeholder="認証コード（6桁）" value={code} onChange={e => setCode(e.target.value)} />}
          <button type="submit" disabled={busy || !password || (info.code && !code)} className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? '確認しています…' : '確認する'}
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-gray-500">
        心当たりがないときや、確認できないときは <button type="button" onClick={logout} className="underline hover:text-gray-700">ログアウト</button> して、ログインし直してください。
      </p>
    </div>
  );
}
