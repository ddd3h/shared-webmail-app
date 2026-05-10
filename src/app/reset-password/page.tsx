'use client';
import { useState, Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function ResetForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      router.replace('/invalid-link?reason=invalid');
      return;
    }

    async function checkToken() {
      try {
        const res = await fetch(`/api/profile/password-reset-check?token=${token}`);
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          const reason = d.error === 'expired' ? 'expired' : d.error === 'used' ? 'used' : 'invalid';
          router.replace(`/invalid-link?reason=${reason}`);
        } else {
          setExpiresAt(d.expires_at);
          setValidating(false);
        }
      } catch (e) {
        setValidating(false); 
      }
    }
    checkToken();
  }, [token, router]);

  // Timer effect
  useEffect(() => {
    if (!expiresAt || done) return;

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(expiresAt).getTime();
      const diff = end - now;

      if (diff <= 0) {
        clearInterval(timer);
        setTimeLeft('0:00');
        router.replace('/invalid-link?reason=expired');
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, done, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('パスワードが一致しません'); return; }
    if (password.length < 8) { setError('8文字以上で設定してください'); return; }
    setLoading(true);
    setError('');
    const res = await fetch('/api/profile/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: password })
    });
    setLoading(false);
    if (res.ok) {
      setDone(true);
    } else {
      const d = await res.json().catch(() => ({}));
      if (d.error === 'token_invalid') {
        router.replace('/invalid-link?reason=expired');
      } else {
        setError(d.error === 'password_too_short' ? 'パスワードは8文字以上で設定してください' : 'エラーが発生しました');
      }
    }
  }

  if (!token) return null;
  if (validating) return <div className="text-center text-sm text-gray-400 animate-pulse">検証中…</div>;

  if (done) {
    return (
      <div className="text-center space-y-4 animate-in fade-in zoom-in duration-300">
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900">パスワードを変更しました</h1>
        <p className="text-sm text-gray-500">新しいパスワードでログインしてください。</p>
        <Link href="/login" className="btn btn-primary w-full justify-center py-2.5">ログインページへ</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="text-center mb-6">
        <h2 className="text-lg font-bold text-gray-900">パスワードをリセット</h2>
        <div className="mt-1 flex items-center justify-center gap-1.5">
          <span className="text-s text-gray-400">有効期限まで</span>
          <span className="text-s font-mono font-bold text-amber-600 animate-pulse">{timeLeft || '--:--'}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-2.5 text-xs text-rose-600 font-medium">
          {error}
        </div>
      )}
      
      <div>
        <label className="label text-xs">新しいパスワード <span className="text-[10px] font-normal text-gray-400">(8文字以上)</span></label>
        <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
      </div>
      
      <div>
        <label className="label text-xs">新しいパスワード（確認）</label>
        <input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
      </div>

      <div className="pt-2">
        <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center py-3 font-bold shadow-lg shadow-blue-100">
          {loading ? '変更中…' : 'パスワードを変更する'}
        </button>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="card p-8 w-full max-w-sm shadow-xl bg-white rounded-[2rem]">
        <Suspense fallback={<div className="text-center text-sm text-gray-400">読み込み中…</div>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
