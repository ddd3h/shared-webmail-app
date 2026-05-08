'use client';
import { useEffect, useState, useCallback } from 'react';
import { startRegistration } from '@simplewebauthn/browser';

type Passkey = {
  id: string;
  name: string;
  device_type: string;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
};

// ── Password change section ──────────────────────────────────────────────────
function PasswordSection() {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function requestReset() {
    setSending(true);
    setMsg(null);
    const res = await fetch('/api/profile/password-reset-request', { method: 'POST' });
    setSending(false);
    if (res.ok) {
      setMsg({ type: 'success', text: 'パスワードリセットのURLをMattermostのDMに送信しました。DMをご確認ください。' });
    } else {
      const d = await res.json().catch(() => ({}));
      const map: Record<string, string> = {
        no_mattermost: 'MattermostアカウントがリンクされていないためDMを送信できません。管理者にお問い合わせください。',
        mattermost_error: 'Mattermostへの送信に失敗しました。設定を確認してください。',
      };
      setMsg({ type: 'error', text: map[d.error] || 'エラーが発生しました' });
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <h2 className="font-semibold text-gray-900">パスワード変更</h2>
      <p className="text-sm text-gray-600">
        「パスワードを変更する」をクリックすると、MattermostのDMにパスワード変更用のURLが送信されます。
      </p>
      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {msg.text}
        </div>
      )}
      <div className="flex">
        <button onClick={requestReset} disabled={sending} className="btn btn-primary btn-sm">
          {sending ? '送信中…' : 'パスワードを変更する'}
        </button>
      </div>
    </div>
  );
}


// ── Mailbox section ──────────────────────────────────────────────────────────
function MailboxSection() {
  const [mailboxes, setMailboxes] = useState<{ id: string; display_name: string; type: string; email_address: string; sync_state?: { last_success_at: string | null } | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({});

  useEffect(() => {
    fetch('/api/mailboxes?mine=1')
      .then(r => r.json())
      .then(d => { setMailboxes(d.items || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function doSync(id: string) {
    setSyncing(prev => ({ ...prev, [id]: true }));
    const res = await fetch(`/api/mailboxes/${id}/resync`, { method: 'POST' });
    setSyncing(prev => ({ ...prev, [id]: false }));
    setResults(prev => ({
      ...prev,
      [id]: res.ok ? { type: 'success', text: '同期完了' } : { type: 'error', text: '同期に失敗しました' }
    }));
    setTimeout(() => setResults(prev => { const next = { ...prev }; delete next[id]; return next; }), 3000);
  }

  async function doTest(id: string) {
    setTesting(prev => ({ ...prev, [id]: true }));
    const res = await fetch(`/api/mailboxes/${id}/test`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setTesting(prev => ({ ...prev, [id]: false }));
    const ok = res.ok && d.imap?.ok && d.smtp?.ok;
    setResults(prev => ({
      ...prev,
      [id]: ok ? { type: 'success', text: '接続OK' } : { type: 'error', text: `接続エラー: ${d.imap?.error || d.smtp?.error || '失敗'}` }
    }));
    setTimeout(() => setResults(prev => { const next = { ...prev }; delete next[id]; return next; }), 4000);
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-gray-900">メールアカウント</h2>
        <p className="text-xs text-gray-500 mt-0.5">割り当てられているメールアカウントの同期・接続テストができます</p>
      </div>
      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : mailboxes.length === 0 ? (
        <p className="text-sm text-gray-400">アクセス可能なメールアカウントはありません</p>
      ) : (
        <div className="space-y-2">
          {mailboxes.map(mb => (
            <div key={mb.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{mb.display_name}</p>
                <p className="text-xs text-gray-400 truncate">{mb.email_address}</p>
                {mb.sync_state?.last_success_at && (
                  <p className="text-xs text-gray-400">最終同期: {new Date(mb.sync_state.last_success_at).toLocaleString('ja-JP')}</p>
                )}
                {results[mb.id] && (
                  <p className={`text-xs mt-0.5 ${results[mb.id].type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {results[mb.id].text}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => doTest(mb.id)} disabled={testing[mb.id]} className="btn btn-secondary btn-sm">
                  {testing[mb.id] ? 'テスト中…' : '接続テスト'}
                </button>
                <button onClick={() => doSync(mb.id)} disabled={syncing[mb.id]} className="btn btn-primary btn-sm">
                  {syncing[mb.id] ? '同期中…' : '同期'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Passkey section ──────────────────────────────────────────────────────────
function PasskeySection() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!window.PublicKeyCredential);
  }, []);

  const fetchPasskeys = useCallback(async () => {
    const res = await fetch('/api/passkeys');
    if (res.ok) {
      const d = await res.json();
      setPasskeys(d.passkeys || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPasskeys(); }, [fetchPasskeys]);

  async function addPasskey() {
    setAdding(true);
    setMsg(null);
    try {
      const optRes = await fetch('/api/passkeys/register-options');
      if (!optRes.ok) throw new Error('オプションの取得に失敗しました');
      const options = await optRes.json();

      let attResp;
      try {
        attResp = await startRegistration({ optionsJSON: options });
      } catch (e: any) {
        if (e?.name === 'NotAllowedError') {
          setMsg({ type: 'error', text: 'パスキーの登録がキャンセルされました' });
          return;
        }
        throw e;
      }

      const verRes = await fetch('/api/passkeys/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...attResp, name: newName || 'パスキー' })
      });

      if (verRes.ok) {
        setMsg({ type: 'success', text: 'パスキーを登録しました' });
        setNewName('');
        setShowNameInput(false);
        await fetchPasskeys();
      } else {
        const d = await verRes.json().catch(() => ({}));
        throw new Error(d.error || '登録に失敗しました');
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'エラーが発生しました' });
    } finally {
      setAdding(false);
    }
  }

  async function removePasskey(id: string) {
    const res = await fetch(`/api/passkeys/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setPasskeys(prev => prev.filter(p => p.id !== id));
      setMsg({ type: 'success', text: 'パスキーを削除しました' });
    }
  }

  if (!supported) {
    return (
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-3">パスキー</h2>
        <p className="text-sm text-gray-500">このブラウザはパスキーに対応していません。</p>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">パスキー</h2>
          <p className="text-xs text-gray-500 mt-0.5">パスワード不要の生体認証・デバイス認証でログインできます</p>
        </div>
        {!showNameInput && (
          <button onClick={() => setShowNameInput(true)} className="btn btn-secondary btn-sm gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            追加
          </button>
        )}
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Add new passkey */}
      {showNameInput && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 space-y-3">
          <p className="text-sm font-medium text-blue-900">新しいパスキーを登録</p>
          <div>
            <label className="label text-blue-800">パスキーの名前（任意）</label>
            <input
              type="text"
              className="input"
              placeholder="例: MacBook Touch ID、iPhone Face ID"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              maxLength={50}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={addPasskey} disabled={adding} className="btn btn-primary btn-sm">
              {adding ? '登録中…' : 'パスキーを登録する'}
            </button>
            <button onClick={() => { setShowNameInput(false); setNewName(''); }} className="btn btn-secondary btn-sm">
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Passkey list */}
      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : passkeys.length === 0 ? (
        <div className="text-center py-6 text-sm text-gray-400">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          パスキーはまだ登録されていません
        </div>
      ) : (
        <div className="space-y-2">
          {passkeys.map(pk => (
            <div key={pk.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{pk.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  登録: {new Date(pk.created_at).toLocaleDateString('ja-JP')}
                  {pk.last_used_at && ` · 最終使用: ${new Date(pk.last_used_at).toLocaleDateString('ja-JP')}`}
                  {pk.backed_up && <span className="ml-1 text-emerald-600">· クラウドバックアップ済み</span>}
                </p>
              </div>
              <button
                onClick={() => removePasskey(pk.id)}
                className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="削除"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Main page ────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const [signature, setSignature] = useState('');
  const [savedSignature, setSavedSignature] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/user/signature')
      .then(r => r.json())
      .then(d => {
        setName(d.name || '');
        setEmail(d.email || '');
        const sig = d.signature ?? `${d.name || ''}\n${d.email || ''}`;
        setSignature(sig);
        setSavedSignature(sig);
        setLoading(false);
      });
  }, []);

  async function saveSig() {
    setSaving(true);
    const res = await fetch('/api/user/signature', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature })
    });
    setSaving(false);
    if (res.ok) {
      setSavedSignature(signature);
      setMsg({ type: 'success', text: '署名を保存しました' });
      setTimeout(() => setMsg(null), 3000);
    } else {
      setMsg({ type: 'error', text: '保存に失敗しました' });
    }
  }

  const isDirty = signature !== savedSignature;

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">読み込み中…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {msg && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${msg.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {msg.text}
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-gray-900">プロフィール設定</h1>
      </div>

      {/* Account info */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">アカウント情報</h2>
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="flex-shrink-0 w-16 h-16 rounded-full overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center text-2xl font-bold text-gray-400">
            {email && (
              <img
                src={`/api/user/avatar?u=${encodeURIComponent(email)}`}
                alt={name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  (e.currentTarget.parentElement as HTMLElement).textContent = name[0]?.toUpperCase() || '?';
                }}
              />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-1">名前</div>
              <div className="font-medium text-gray-900">{name}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">メールアドレス</div>
              <div className="font-medium text-gray-900">{email}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mailboxes */}
      <MailboxSection />

      {/* Password change */}
      <PasswordSection />

      {/* Passkeys */}
      <PasskeySection />

      {/* Signature */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">メール署名</h2>
            <p className="text-xs text-gray-500 mt-0.5">返信フォームを開いたとき、本文末尾に自動で挿入されます</p>
          </div>
          {isDirty && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">未保存の変更</span>
          )}
        </div>
        <textarea
          className="input resize-y font-mono text-sm"
          rows={5}
          value={signature}
          onChange={e => setSignature(e.target.value)}
          placeholder={`${name}\n${email}`}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">プレーンテキスト形式</p>
          <div className="flex gap-2">
            <button onClick={() => setSignature(savedSignature)} disabled={!isDirty} className="btn btn-secondary btn-sm">リセット</button>
            <button onClick={saveSig} disabled={saving || !isDirty} className="btn btn-primary btn-sm">
              {saving ? '保存中…' : '署名を保存'}
            </button>
          </div>
        </div>
        {signature && (
          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
            <p className="text-xs text-gray-400 mb-2">プレビュー</p>
            <div className="border-t border-gray-300 pt-2">
              <pre className="text-xs text-gray-600 font-sans whitespace-pre-wrap">{signature}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
