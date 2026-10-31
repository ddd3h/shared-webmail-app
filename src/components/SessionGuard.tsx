'use client';
import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { isStandalone, rememberFlag } from '@/lib/device-key';

// Every fetch of the page passes through here, so no screen has to handle these two things itself:
//
// 1. The server says the session is over (401 from the app's own API): the person is taken to the login screen at once, remembering where they were
//    (the login brings them back). Without this a screen whose session ended while it was open stays on screen with an empty list or an error.
// 2. The server says a high-risk action needs a RECENT proof of who is asking (403 `recent_login_required`): the password is asked for here, in a
//    dialog, and the very same request is sent again. The person does not lose what they were doing.
//
// Not counted: the login steps themselves (/api/auth/*: a 401 there is an ordinary "wrong password" / "no device key"), which have their own handling.
const IGNORED = ['/api/auth/', '/api/passkeys/auth', '/api/profile/password-reset', '/api/cron/'];

function appApiPath(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin || !u.pathname.startsWith('/api/')) return null;
    return u.pathname;
  } catch { return null; }
}

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500';

export default function SessionGuard() {
  const [asking, setAsking] = useState(false);
  const waiting = useRef<((ok: boolean) => void)[]>([]);
  const pending = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const original = window.fetch;
    let leaving = false;
    function toLogin() {
      if (leaving) return;
      leaving = true;
      const q = new URLSearchParams({ from: window.location.pathname + window.location.search });
      // the installed app that stays logged in logs in again by itself on the login screen (with its device key): no message needed
      if (!(isStandalone() && rememberFlag())) q.set('reason', 'expired');
      window.location.assign(`/login?${q}`);
    }
    /** One dialog at a time, however many requests are waiting for it. */
    function askProof(): Promise<boolean> {
      pending.current ??= new Promise<boolean>(resolve => { waiting.current.push(resolve); setAsking(true); }).finally(() => { pending.current = null; });
      return pending.current;
    }
    window.fetch = async function guarded(input: RequestInfo | URL, init?: RequestInit) {
      const again = input instanceof Request ? input.clone() : input; // (a request that carries a body can only be read once)
      const res = await original.call(window, input, init);
      const path = appApiPath(input);
      if (!path) return res;
      if (res.status === 401 && !IGNORED.some(p => path.startsWith(p))) toLogin();
      if (res.status === 403 && !path.startsWith('/api/auth/')) {
        const body = await res.clone().json().catch(() => null);
        if (body?.error === 'recent_login_required' && (await askProof())) return original.call(window, again, init);
      }
      return res;
    };
    return () => { window.fetch = original; };
  }, []);

  function done(ok: boolean) { setAsking(false); waiting.current.splice(0).forEach(r => r(ok)); }
  return asking ? <ProofDialog onDone={done} /> : null;
}

function ProofDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const res = await fetch('/api/auth/reauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, ...(code ? { code } : {}) }) });
    setBusy(false);
    if (res.ok) { onDone(true); return; }
    const d = await res.json().catch(() => ({}));
    if (res.status === 429) setError('間違いが続いたため、しばらく使えません。時間をおいてやり直してください');
    else if (d.error === 'invalid_code') { setNeedCode(true); setError('認証コードを入れてください（認証アプリの6桁の数字）'); }
    else if (d.error === 'wrong_password') setError('パスワードが違います');
    else setError('確認できませんでした。いったんログアウトして、ログインし直してください');
  }

  return (
    <Modal title="パスワードの確認" onClose={() => onDone(false)}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-600">影響の大きい操作です。安全のため、パスワードをもう一度入れてください。確認できると、続きの操作がそのまま実行されます。</p>
        <input className={inp} type="password" autoComplete="current-password" autoFocus aria-label="パスワード" placeholder="パスワード" value={password} onChange={e => setPassword(e.target.value)} />
        {needCode && <input className={inp} inputMode="numeric" autoComplete="one-time-code" aria-label="認証コード" placeholder="認証コード（6桁）" value={code} onChange={e => setCode(e.target.value)} />}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => onDone(false)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">やめる</button>
          <button type="submit" disabled={busy || !password} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">確認する</button>
        </div>
      </form>
    </Modal>
  );
}
