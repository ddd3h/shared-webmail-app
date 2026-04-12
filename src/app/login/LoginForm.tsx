'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';

export default function LoginForm() {
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    setMounted(true);
    setPasskeySupported(typeof window !== 'undefined' && !!window.PublicKeyCredential);
  }, []);

  const redirect = () => {
    const from = searchParams.get('from') || '/';
    router.push(from);
    router.refresh();
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === 'unauthorized' ? 'メールアドレスまたはパスワードが正しくありません' : 'ログインに失敗しました');
        return;
      }
      redirect();
    } catch {
      setError('ネットワークエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  async function loginWithPasskey() {
    setError(null);
    setPasskeyLoading(true);
    try {
      // Get options (pass email if filled in, for non-discoverable credentials)
      const optRes = await fetch('/api/passkeys/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || undefined })
      });
      if (!optRes.ok) throw new Error('認証オプションの取得に失敗しました');
      const { challengeId, ...options } = await optRes.json();

      let authResp;
      try {
        authResp = await startAuthentication({ optionsJSON: options });
      } catch (e: any) {
        if (e?.name === 'NotAllowedError') {
          setError('パスキー認証がキャンセルされました');
          return;
        }
        throw e;
      }

      const verRes = await fetch('/api/passkeys/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authResp, challengeId })
      });

      if (verRes.ok) {
        redirect();
      } else {
        const d = await verRes.json().catch(() => ({}));
        const map: Record<string, string> = {
          credential_not_found: '登録されていないパスキーです',
          challenge_expired: 'タイムアウトしました。もう一度お試しください',
          verification_failed: 'パスキーの認証に失敗しました',
        };
        setError(map[d.error] || 'パスキー認証に失敗しました');
      }
    } catch (e: any) {
      setError(e?.message || 'エラーが発生しました');
    } finally {
      setPasskeyLoading(false);
    }
  }

  return (
    <div className="card p-8 shadow-xl">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">ログイン</h2>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            className="input"
            placeholder="admin@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary w-full justify-center py-2.5"
          disabled={loading || passkeyLoading}
        >
          {loading ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>

      {mounted && passkeySupported && (
        <>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 border-t border-gray-200" />
            <span className="text-xs text-gray-400">または</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>
          <button
            onClick={loginWithPasskey}
            disabled={loading || passkeyLoading}
            className="btn btn-secondary w-full justify-center py-2.5 gap-2"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            {passkeyLoading ? '認証中…' : 'パスキーでログイン'}
          </button>
          <p className="mt-2 text-xs text-center text-gray-400">
            Touch ID・Face ID・セキュリティキーでログインできます
          </p>
        </>
      )}

      <p className="mt-5 text-xs text-center text-gray-400">
        社内専用システムです。権限のある方のみ利用できます。
      </p>
    </div>
  );
}
