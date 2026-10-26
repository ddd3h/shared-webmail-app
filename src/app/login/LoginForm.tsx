'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import { CodeStep, RecoveryCodesView, SetupStep } from '@/components/security/TwoFactorParts';
import { createDeviceKey, deviceKeySupported, forgetDeviceLogin, isStandalone, rememberFlag, resumeWithDeviceKey, setRememberFlag } from '@/lib/device-key';

// credentials → (code | setup → codes): the second step only appears for a password login; passkeys skip it
type Step = 'credentials' | 'code' | 'setup' | 'codes';
type Setup = { qr: string; secret: string; token: string };
const CODE_ERRORS: Record<string, string> = {
  invalid_code: 'コードが正しくありません', challenge_expired: '時間切れです。最初からやり直してください', too_many_requests: '間違いが続いたため、しばらく入力できません。時間をおいてお試しください',
};

export default function LoginForm() {
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [step, setStep] = useState<Step>('credentials');
  const [challenge, setChallenge] = useState('');
  const [trustDays, setTrustDays] = useState(0);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();

  // The installed app (home-screen icon) can stay logged in: it has its own key, which proves it is the same device (lib/device-key.ts)
  const [installed, setInstalled] = useState(false);
  const [keepLogin, setKeepLogin] = useState(true);
  const [resuming, setResuming] = useState(false);
  const deviceKey = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setPasskeySupported(typeof window !== 'undefined' && !!window.PublicKeyCredential);
    const app = isStandalone() && deviceKeySupported();
    setInstalled(app);
    // came back after the session ended (idle time, another network): log in again with the device key, no password
    if (app && rememberFlag()) {
      setResuming(true);
      resumeWithDeviceKey().then(async r => {
        if (r === 'ok') { const from = searchParams.get('from') || '/'; router.replace(from); router.refresh(); return; }
        if (r === 'refused') await forgetDeviceLogin(); // expired, logged out elsewhere, or not this device: the password is needed
        setResuming(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The headers of a login request: the app's public key rides along when "keep me logged in" is on. */
  async function loginHeaders(): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (installed && keepLogin) {
      try { deviceKey.current ??= await createDeviceKey(); h['x-device-key'] = deviceKey.current; } catch { /* no key: a normal login */ }
    }
    return h;
  }
  /** The server says whether it will keep this app logged in (x-remember-days); the flag follows its answer. */
  async function noteResult(res: Response) {
    if (!installed || !deviceKey.current) return;
    if (res.headers.get('x-remember-days')) setRememberFlag(true);
    else await forgetDeviceLogin();
  }

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
        headers: await loginHeaders(),
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === 'unauthorized' ? 'メールアドレスまたはパスワードが正しくありません' : data.error === 'too_many_requests' ? '試行回数が多すぎます。しばらくしてからお試しください' : 'ログインに失敗しました');
        return;
      }
      if (res.ok && !data.mfa_required && !data.mfa_setup_required) await noteResult(res); // only when a session was made
      if (data.mfa_required) { setChallenge(data.challenge); setTrustDays(data.trust_days ?? 0); setStep('code'); return; }
      if (data.mfa_setup_required) { await beginSetup(data.challenge); return; }
      redirect();
    } catch {
      setError('ネットワークエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  // ---- second step ----
  const backToStart = () => { setStep('credentials'); setError(null); setPassword(''); setSetup(null); };

  async function beginSetup(note: string) {
    const res = await fetch('/api/auth/mfa/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: note }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(CODE_ERRORS[d.error] ?? '2段階認証を開始できませんでした'); return; }
    setSetup({ qr: d.qr, secret: d.secret, token: d.setup_token });
    setStep('setup');
  }

  async function submitCode(code: string, trust: boolean) {
    setError(null); setLoading(true);
    try {
      const res = await fetch('/api/auth/mfa/verify', { method: 'POST', headers: await loginHeaders(), body: JSON.stringify({ challenge, code, trust_device: trust }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { await noteResult(res); redirect(); return; }
      setError(CODE_ERRORS[d.error] ?? 'ログインに失敗しました');
      if (d.error === 'challenge_expired') backToStart();
    } catch { setError('ネットワークエラーが発生しました'); } finally { setLoading(false); }
  }

  async function submitSetupCode(code: string) {
    if (!setup) return;
    setError(null); setLoading(true);
    try {
      const res = await fetch('/api/auth/mfa/enable', { method: 'POST', headers: await loginHeaders(), body: JSON.stringify({ setup_token: setup.token, code }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { await noteResult(res); setCodes(d.recovery_codes ?? []); setStep('codes'); return; } // signed in already; the codes are shown before moving on
      setError(CODE_ERRORS[d.error] ?? '設定できませんでした');
      if (d.error === 'challenge_expired') backToStart();
    } catch { setError('ネットワークエラーが発生しました'); } finally { setLoading(false); }
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
        headers: await loginHeaders(),
        body: JSON.stringify({ ...authResp, challengeId })
      });

      if (verRes.ok) {
        await noteResult(verRes);
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

  if (resuming) {
    return <div className="card p-8 shadow-xl text-center text-sm text-gray-500" role="status">ログインしています…</div>;
  }

  return (
    <div className="card p-8 shadow-xl">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">{step === 'credentials' ? 'ログイン' : step === 'code' ? '2段階認証' : step === 'setup' ? '2段階認証の設定' : '回復コード'}</h2>

      {step === 'code' && <CodeStep onSubmit={submitCode} onCancel={backToStart} trustDays={trustDays} busy={loading} error={error} />}
      {step === 'setup' && setup && (
        <>
          <p className="mb-4 rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">パスワードでログインするには、2段階認証（認証アプリ）の設定が必要です。パスキーを使う場合は不要です。</p>
          <SetupStep qr={setup.qr} secret={setup.secret} onSubmit={submitSetupCode} onCancel={backToStart} busy={loading} error={error} />
        </>
      )}
      {step === 'codes' && <RecoveryCodesView codes={codes} onDone={redirect} doneLabel="ログインを続ける" />}

      {step === 'credentials' && error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {step === 'credentials' && <form onSubmit={onSubmit} className="space-y-4">
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
        {installed && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={keepLogin} onChange={e => setKeepLogin(e.target.checked)} />
            <span>このアプリでログインを維持する<span className="block text-xs text-gray-500">この端末の鍵で確認します。しばらく使わないと、自動でログアウトします。</span></span>
          </label>
        )}
        <button
          type="submit"
          className="btn btn-primary w-full justify-center py-2.5"
          disabled={loading || passkeyLoading}
        >
          {loading ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>}

      {step === 'credentials' && mounted && passkeySupported && (
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
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
