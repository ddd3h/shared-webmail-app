'use client';
import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function ResetForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

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
      const map: Record<string, string> = {
        token_invalid: 'このリンクは無効または期限切れです。再度リセットをリクエストしてください。',
        password_too_short: 'パスワードは8文字以上で設定してください',
      };
      setError(map[d.error] || 'エラーが発生しました');
    }
  }

  if (!token) {
    return (
      <div className="text-center text-sm text-gray-500">
        <p>無効なリンクです。</p>
        <Link href="/login" className="mt-3 inline-block text-blue-600 hover:underline">ログインページへ</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-900">パスワードを変更しました</p>
        <Link href="/login" className="inline-block text-sm text-blue-600 hover:underline">ログインページへ</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">パスワードをリセット</h2>
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <div>
        <label className="label">新しいパスワード <span className="text-xs font-normal text-gray-400">（8文字以上）</span></label>
        <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
      </div>
      <div>
        <label className="label">新しいパスワード（確認）</label>
        <input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
      </div>
      <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center py-2.5">
        {loading ? '変更中…' : 'パスワードを変更する'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="card p-8 w-full max-w-sm shadow-xl">
        <Suspense fallback={<div className="text-center text-sm text-gray-400">読み込み中…</div>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
