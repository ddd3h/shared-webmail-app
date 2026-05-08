'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Item = { key: string; value: string; isSecret: boolean };
type User = { id: string; name: string; email: string; role: string; mattermost_user_id: string | null };
type EditUser = { name: string; email: string; role: string; password: string; mattermost_user_id: string };
type PermEntry = { can_view: boolean; can_reply: boolean; can_assign: boolean };
type MbForm = {
  type: string; display_name: string; email_address: string;
  username: string; password: string;
  imap_host: string; imap_port: number; imap_secure: boolean;
  smtp_host: string; smtp_port: number; smtp_secure: boolean;
  mattermost_channel_id: string;
  sync_mode: string;
};
const DEFAULT_MB_FORM: MbForm = {
  type: 'personal', display_name: '', email_address: '', username: '', password: '',
  imap_host: process.env.NEXT_PUBLIC_DEFAULT_IMAP_HOST || 'imap.lolipop.jp',
  imap_port: Number(process.env.NEXT_PUBLIC_DEFAULT_IMAP_PORT) || 993,
  imap_secure: process.env.NEXT_PUBLIC_DEFAULT_IMAP_SECURE !== 'false',
  smtp_host: process.env.NEXT_PUBLIC_DEFAULT_SMTP_HOST || 'smtp.lolipop.jp',
  smtp_port: Number(process.env.NEXT_PUBLIC_DEFAULT_SMTP_PORT) || 465,
  smtp_secure: process.env.NEXT_PUBLIC_DEFAULT_SMTP_SECURE !== 'false',
  mattermost_channel_id: '',
  sync_mode: 'poll',
};
type MailboxFull = {
  id: string;
  type: 'personal' | 'team';
  display_name: string;
  email_address: string;
  is_active: boolean;
  sync_mode: string;
  owner_user_id: string | null;
  owner: { id: string; name: string } | null;
  sync_state: {
    status: string;
    last_sync_started_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
  } | null;
  credentials: { imap_host: string; last_test_status: string | null; last_tested_at: string | null } | null;
  permissions: { user_id: string; can_view: boolean; can_reply: boolean; can_assign: boolean }[];
};

function AdminSettingsContent() {
  const [items, setItems] = useState<Item[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxFull[]>([]);
  const [mbLoading, setMbLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<'system' | 'mailboxes' | 'users'>('system');
  const [googleLinked, setGoogleLinked] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const searchParams = useSearchParams();
  // Per-mailbox interaction state
  const [expandedPerms, setExpandedPerms] = useState<string | null>(null);
  const [permsEdit, setPermsEdit] = useState<Record<string, PermEntry>>({});
  const [savingPerms, setSavingPerms] = useState(false);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});

  // Mailbox modal
  const [showMbModal, setShowMbModal] = useState(false);
  const [mbModalId, setMbModalId] = useState<string | null>(null);
  const [mbForm, setMbForm] = useState<MbForm>(DEFAULT_MB_FORM);
  const [mbSaving, setMbSaving] = useState(false);

  // New user form
  const [showUserForm, setShowUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'user', mattermost_user_id: '' });

  // Edit user
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditUser>({ name: '', email: '', role: 'user', password: '', mattermost_user_id: '' });

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function loadUsers() {
    const data = await fetch('/api/users').then(r => r.json());
    setUsers(data.items || []);
  }

  useEffect(() => {
    // Show result of Google OAuth callback
    const googleLinkedParam = searchParams.get('google_linked');
    const googleErrorParam = searchParams.get('google_error');
    const googleDetail = searchParams.get('detail');
    if (googleLinkedParam) showMsg('success', 'Googleアカウントの連携が完了しました');
    if (googleErrorParam) {
      const errorMap: Record<string, string> = {
        access_denied: 'Googleアカウントへのアクセスが拒否されました',
        token_exchange_failed: `トークン取得に失敗しました${googleDetail ? ': ' + decodeURIComponent(googleDetail) : ''}`,
        not_configured: 'Google OAuth が設定されていません（GOOGLE_CLIENT_ID/SECRET を確認してください）',
        internal_error: '内部エラーが発生しました（サーバーログを確認してください）',
      };
      showMsg('error', errorMap[googleErrorParam] || `Google連携エラー: ${googleErrorParam}`);
    }

    Promise.all([
      fetch('/api/admin/settings').then(r => r.json()),
      fetch('/api/users').then(r => r.json()),
      fetch('/api/contacts/google/sync').then(r => r.json()).catch(() => ({ linked: false }))
    ]).then(([settings, usersData, googleStatus]) => {
      setItems(settings.items || []);
      setUsers(usersData.items || []);
      setGoogleLinked(googleStatus.linked ?? false);
      setLoading(false);
    });
  }, [searchParams]);

  function getVal(key: string) {
    return items.find(i => i.key === key)?.value || '';
  }

  function setVal(key: string, value: string, isSecret = false) {
    setItems(prev => {
      const idx = prev.findIndex(x => x.key === key);
      if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], value }; return copy; }
      return [...prev, { key, value, isSecret }];
    });
  }

  async function save() {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: items })
    });
    if (res.ok) showMsg('success', '設定を保存しました');
    else showMsg('error', '保存に失敗しました');
  }

  async function syncGoogleContacts() {
    setGoogleSyncing(true);
    const res = await fetch('/api/contacts/google/sync', { method: 'POST' });
    setGoogleSyncing(false);
    if (res.ok) {
      const d = await res.json();
      showMsg('success', `Google連絡帳を同期しました（${d.synced} 件追加・更新、${d.skipped} 件スキップ）`);
    } else {
      const d = await res.json().catch(() => ({}));
      if (d.error === 'not_linked') showMsg('error', 'Googleアカウントが連携されていません');
      else showMsg('error', 'Google同期に失敗しました');
    }
  }

  async function disconnectGoogle() {
    if (!confirm('Googleアカウントの連携を解除しますか？')) return;
    const res = await fetch('/api/contacts/google/sync', { method: 'DELETE' });
    if (res.ok) {
      setGoogleLinked(false);
      showMsg('success', 'Googleアカウントの連携を解除しました');
    } else {
      showMsg('error', '連携解除に失敗しました');
    }
  }

  async function generateVapid() {
    const res = await fetch('/api/admin/settings/generate-vapid', { method: 'POST' });
    if (res.ok) {
      // Reload settings from server so secret keys show '••••••' (not a placeholder string)
      const updated = await fetch('/api/admin/settings').then(r => r.json());
      setItems(updated.items || []);
      showMsg('success', 'VAPID鍵を生成しました。次回から通知設定でテスト送信できます。');
    } else showMsg('error', 'VAPID鍵の生成に失敗しました');
  }

  async function createUser() {
    const res = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    });
    if (res.ok) {
      showMsg('success', 'ユーザーを作成しました');
      setNewUser({ name: '', email: '', password: '', role: 'user', mattermost_user_id: '' });
      setShowUserForm(false);
      await loadUsers();
    } else {
      const err = await res.json().catch(() => ({}));
      showMsg('error', `ユーザー作成に失敗しました: ${err.error || ''}`);
    }
  }

  function openEdit(u: User) {
    setEditingId(u.id);
    setEditForm({ name: u.name, email: u.email, role: u.role, password: '', mattermost_user_id: u.mattermost_user_id || '' });
  }

  async function saveEdit() {
    if (!editingId) return;
    const body: Record<string, string | null> = {
      name: editForm.name,
      email: editForm.email,
      role: editForm.role,
      mattermost_user_id: editForm.mattermost_user_id || null,
    };
    if (editForm.password) body.password = editForm.password;
    const res = await fetch(`/api/users/${editingId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showMsg('success', 'ユーザーを更新しました');
      setEditingId(null);
      await loadUsers();
    } else {
      const err = await res.json().catch(() => ({}));
      showMsg('error', `更新に失敗しました: ${err.error || ''}`);
    }
  }

  async function deleteUser(u: User) {
    if (!confirm(`「${u.name}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
    if (res.ok) {
      showMsg('success', 'ユーザーを削除しました');
      await loadUsers();
    } else {
      const err = await res.json().catch(() => ({}));
      if (err.error === 'cannot_delete_self') showMsg('error', '自分自身は削除できません');
      else showMsg('error', '削除に失敗しました');
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-sm text-gray-400">読み込み中…</div>;

  async function loadMailboxes() {
    setMbLoading(true);
    const data = await fetch('/api/mailboxes').then(r => r.json()).catch(() => ({ items: [] }));
    setMailboxes(data.items || []);
    setMbLoading(false);
  }

  async function doSync(id: string) {
    setSyncing(prev => new Set(prev).add(id));
    await fetch(`/api/mailboxes/${id}/resync`, { method: 'POST' });
    setTimeout(async () => {
      await loadMailboxes();
      setSyncing(prev => { const s = new Set(prev); s.delete(id); return s; });
    }, 1500);
  }

  async function doTest(id: string) {
    setTesting(prev => new Set(prev).add(id));
    const res = await fetch(`/api/mailboxes/${id}/test`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setTesting(prev => { const s = new Set(prev); s.delete(id); return s; });
    const ok = res.ok && d.imap?.ok && d.smtp?.ok;
    setTestResults(prev => ({
      ...prev,
      [id]: { ok, msg: ok ? '接続OK' : (d.imap?.error || d.smtp?.error || '接続失敗') }
    }));
    setTimeout(() => setTestResults(prev => { const n = { ...prev }; delete n[id]; return n; }), 5000);
  }

  async function changeOwner(mailboxId: string, userId: string) {
    const res = await fetch(`/api/mailboxes/${mailboxId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_user_id: userId || null })
    });
    if (res.ok) { showMsg('success', '担当ユーザーを変更しました'); await loadMailboxes(); }
    else showMsg('error', '変更に失敗しました');
  }

  function openPerms(mb: MailboxFull) {
    const map: Record<string, PermEntry> = {};
    users.forEach(u => {
      const p = mb.permissions.find(pp => pp.user_id === u.id);
      map[u.id] = { can_view: !!p?.can_view, can_reply: !!p?.can_reply, can_assign: !!p?.can_assign };
    });
    setPermsEdit(map);
    setExpandedPerms(mb.id);
  }

  async function openMailboxModal(id: string | null) {
    setMbModalId(id);
    if (id) {
      const res = await fetch(`/api/mailboxes/${id}`);
      if (!res.ok) { showMsg('error', '設定の取得に失敗しました'); return; }
      const data = await res.json();
      setMbForm({
        type: data.type, display_name: data.display_name, email_address: data.email_address,
        username: data.credentials?.username ?? '', password: '',
        imap_host: data.credentials?.imap_host ?? 'imap.chart-inc.com',
        imap_port: data.credentials?.imap_port ?? 993,
        imap_secure: data.credentials?.imap_secure ?? true,
        smtp_host: data.credentials?.smtp_host ?? 'smtp.chart-inc.com',
        smtp_port: data.credentials?.smtp_port ?? 465,
        smtp_secure: data.credentials?.smtp_secure ?? true,
        mattermost_channel_id: data.mattermost_channel_id ?? '',
        sync_mode: data.sync_mode ?? 'poll'
      });
    } else {
      setMbForm(DEFAULT_MB_FORM);
    }
    setShowMbModal(true);
  }

  async function saveMailboxModal() {
    setMbSaving(true);
    let res: Response;
    if (mbModalId) {
      res = await fetch(`/api/mailboxes/${mbModalId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: mbForm.type, display_name: mbForm.display_name,
          sync_mode: mbForm.sync_mode,
          mattermost_channel_id: mbForm.mattermost_channel_id || null,
          credentials: {
            username: mbForm.username,
            ...(mbForm.password ? { password: mbForm.password } : {}),
            imap: { host: mbForm.imap_host, port: Number(mbForm.imap_port), secure: mbForm.imap_secure },
            smtp: { host: mbForm.smtp_host, port: Number(mbForm.smtp_port), secure: mbForm.smtp_secure }
          }
        })
      });
    } else {
      res = await fetch('/api/mailboxes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: mbForm.type, display_name: mbForm.display_name, email_address: mbForm.email_address,
          username: mbForm.username, password: mbForm.password,
          imap: { host: mbForm.imap_host, port: Number(mbForm.imap_port), secure: mbForm.imap_secure },
          smtp: { host: mbForm.smtp_host, port: Number(mbForm.smtp_port), secure: mbForm.smtp_secure }
        })
      });
    }
    setMbSaving(false);
    if (res.ok) {
      showMsg('success', mbModalId ? 'メールアカウントを更新しました' : 'メールアカウントを作成しました');
      setShowMbModal(false);
      await loadMailboxes();
    } else {
      const err = await res.json().catch(() => ({}));
      showMsg('error', `${mbModalId ? '更新' : '作成'}に失敗しました: ${err.error || ''}`);
    }
  }

  async function deleteMailboxModal(mb: MailboxFull) {
    if (!confirm(`「${mb.display_name}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    const res = await fetch(`/api/mailboxes/${mb.id}`, { method: 'DELETE' });
    if (res.ok) {
      showMsg('success', 'メールアカウントを削除しました');
      setShowMbModal(false);
      await loadMailboxes();
    } else {
      showMsg('error', '削除に失敗しました');
    }
  }

  async function savePerms(mailboxId: string) {
    setSavingPerms(true);
    const items = users.map(u => ({
      user_id: u.id,
      can_view: !!permsEdit[u.id]?.can_view,
      can_reply: !!permsEdit[u.id]?.can_reply,
      can_assign: !!permsEdit[u.id]?.can_assign
    }));
    const res = await fetch(`/api/mailboxes/${mailboxId}/permissions`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    setSavingPerms(false);
    if (res.ok) { showMsg('success', '権限を保存しました'); setExpandedPerms(null); await loadMailboxes(); }
    else showMsg('error', '権限の保存に失敗しました');
  }

  const tabs = [
    { id: 'system', label: 'システム設定' },
    { id: 'mailboxes', label: 'メールアカウント' },
    { id: 'users', label: 'ユーザー管理' }
  ] as const;

  return (
    <div className="space-y-6">
      {msg && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${msg.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {msg.text}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">管理設定</h1>
        <p className="text-sm text-gray-500 mt-0.5">システム設定・ユーザー管理を行います（管理者専用）</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); if (t.id === 'mailboxes') loadMailboxes(); }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* System Settings */}
      {tab === 'system' && (
        <div className="space-y-6 max-w-2xl">
          <div className="card p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Web Push (VAPID)</h2>
            <div className="space-y-3">
              <div>
                <label className="label">VAPID 公開鍵</label>
                <input className="input font-mono text-xs" value={getVal('VAPID_PUBLIC_KEY')} onChange={e => setVal('VAPID_PUBLIC_KEY', e.target.value)} placeholder="未設定" />
              </div>
              <div>
                <label className="label">VAPID 秘密鍵</label>
                <input type="password" className="input font-mono text-xs" value={getVal('VAPID_PRIVATE_KEY')} onChange={e => setVal('VAPID_PRIVATE_KEY', e.target.value)} placeholder="未設定" />
              </div>
              <div>
                <label className="label">VAPID Subject</label>
                <input className="input" value={getVal('VAPID_SUBJECT')} onChange={e => setVal('VAPID_SUBJECT', e.target.value)} placeholder="mailto:admin@example.com" />
              </div>
              <button onClick={generateVapid} className="btn btn-secondary btn-sm">🔑 VAPID鍵を自動生成</button>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Mattermost</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Base URL</label>
                <input className="input" value={getVal('MATTERMOST_BASE_URL')} onChange={e => setVal('MATTERMOST_BASE_URL', e.target.value)} placeholder="https://mattermost.example.com" />
              </div>
              <div>
                <label className="label">Bot Token</label>
                <input type="password" className="input" value={getVal('MATTERMOST_BOT_TOKEN')} onChange={e => setVal('MATTERMOST_BOT_TOKEN', e.target.value)} placeholder="xoxb-..." />
              </div>
              <div>
                <label className="label">デフォルトチャンネルID</label>
                <input className="input" value={getVal('MATTERMOST_DEFAULT_CHANNEL_ID')} onChange={e => setVal('MATTERMOST_DEFAULT_CHANNEL_ID', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-semibold text-gray-900 mb-4">同期設定</h2>
            <div>
              <label className="label">同期間隔（秒）</label>
              <input type="number" className="input" value={getVal('SYNC_DEFAULT_INTERVAL_SEC')} onChange={e => setVal('SYNC_DEFAULT_INTERVAL_SEC', e.target.value)} placeholder="180" />
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-semibold text-gray-900 mb-1">AI返信アシスト</h2>
            <p className="text-xs text-gray-500 mb-4">OpenRouter経由でAIによる返信文生成・校正を利用できます。APIキーは <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">openrouter.ai</a> で取得してください。</p>
            <div className="space-y-3">
              <div>
                <label className="label">OpenRouter APIキー</label>
                <input type="password" className="input font-mono text-xs" value={getVal('OPENROUTER_API_KEY')} onChange={e => setVal('OPENROUTER_API_KEY', e.target.value, true)} placeholder="sk-or-..." />
              </div>
              <div>
                <label className="label">使用モデル</label>
                <input className="input font-mono text-xs" value={getVal('OPENROUTER_MODEL')} onChange={e => setVal('OPENROUTER_MODEL', e.target.value)} placeholder="anthropic/claude-3.5-haiku" />
                <p className="text-xs text-gray-400 mt-1">例: anthropic/claude-3.5-haiku、openai/gpt-4o-mini</p>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Google 連絡帳</h2>
            <p className="text-xs text-gray-500 mb-4">Googleアカウントを連携し、Google Contactsの連絡先を社内連絡帳に同期します。</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${googleLinked ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${googleLinked ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                {googleLinked ? '連携済み' : '未連携'}
              </span>
              {googleLinked ? (
                <div className="flex gap-2">
                  <button onClick={syncGoogleContacts} disabled={googleSyncing} className="btn btn-secondary btn-sm gap-1.5">
                    <svg className={`w-4 h-4 ${googleSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {googleSyncing ? '同期中…' : '今すぐ同期'}
                  </button>
                  <button onClick={disconnectGoogle} className="btn btn-secondary btn-sm text-red-600 hover:bg-red-50 border-red-100">
                    連携を解除
                  </button>
                </div>
              ) : (
                <a href="/api/contacts/google/auth" className="btn btn-secondary btn-sm gap-1.5">
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Googleアカウントで連携
                </a>
              )}
            </div>
          </div>

          <button onClick={save} className="btn btn-primary">設定を保存</button>
        </div>
      )}

      {/* Mailbox Management */}
      {tab === 'mailboxes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">全メールアカウントの設定・同期状態・担当ユーザー管理</p>
            <div className="flex gap-2">
              <button onClick={loadMailboxes} disabled={mbLoading} className="btn btn-secondary btn-sm">
                {mbLoading ? '更新中…' : '更新'}
              </button>
              <button onClick={() => openMailboxModal(null)} className="btn btn-primary btn-sm">+ 追加</button>
            </div>
          </div>

          {mbLoading && mailboxes.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">読み込み中…</div>
          ) : mailboxes.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">メールアカウントがありません</div>
          ) : (
            <div className="space-y-3">
              {mailboxes.map(mb => {
                const ss = mb.sync_state;
                const status = ss?.status ?? 'none';
                const statusColor = status === 'idle' ? 'bg-emerald-100 text-emerald-700' : status === 'running' ? 'bg-blue-100 text-blue-700' : status === 'error' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500';
                const statusLabel = status === 'idle' ? '正常' : status === 'running' ? '同期中' : status === 'error' ? 'エラー' : '未同期';
                const fmt = (d: string | null) => d ? new Date(d).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
                const tr = testResults[mb.id];
                const isPermsOpen = expandedPerms === mb.id;

                return (
                  <div key={mb.id} className="card overflow-hidden">
                    <div className="p-4">
                      {/* Header row */}
                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                            {status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-1.5" />}
                            {statusLabel}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${mb.type === 'team' ? 'bg-purple-50 text-purple-700 ring-purple-200' : 'bg-sky-50 text-sky-700 ring-sky-200'}`}>
                            {mb.type === 'team' ? 'チーム' : '個人'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{mb.display_name}</p>
                          <p className="text-xs text-gray-400">{mb.email_address}</p>
                          {mb.credentials?.imap_host && (
                            <p className="text-xs text-gray-400">IMAP: {mb.credentials.imap_host}</p>
                          )}
                          <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${mb.sync_mode === 'idle' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                            {mb.sync_mode === 'idle' ? (
                              <><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />IDLE</>
                            ) : 'ポーリング'}
                          </span>
                        </div>
                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                          {tr && (
                            <span className={`text-xs px-2 py-0.5 rounded ${tr.ok ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                              {tr.msg}
                            </span>
                          )}
                          <button
                            onClick={() => doTest(mb.id)}
                            disabled={testing.has(mb.id)}
                            className="btn btn-secondary btn-sm"
                          >
                            {testing.has(mb.id) ? 'テスト中…' : '接続テスト'}
                          </button>
                          <button
                            onClick={() => doSync(mb.id)}
                            disabled={syncing.has(mb.id)}
                            className="btn btn-secondary btn-sm"
                          >
                            {syncing.has(mb.id) ? '同期中…' : '今すぐ同期'}
                          </button>
                          <button onClick={() => openMailboxModal(mb.id)} className="btn btn-secondary btn-sm text-xs">設定</button>
                        </div>
                      </div>

                      {/* Sync timing */}
                      <div className="mt-2 flex gap-4 text-xs text-gray-400">
                        <span>最終成功: {fmt(ss?.last_success_at ?? null)}</span>
                        <span>最終開始: {fmt(ss?.last_sync_started_at ?? null)}</span>
                      </div>

                      {/* Error */}
                      {ss?.last_error && (
                        <div className="mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded text-xs text-red-600 font-mono break-all">
                          {ss.last_error}
                        </div>
                      )}

                      {/* Personal: owner assignment */}
                      {mb.type === 'personal' && (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs text-gray-500 flex-shrink-0">担当ユーザー:</span>
                          <select
                            className="select text-sm py-1 flex-1 max-w-xs"
                            value={mb.owner_user_id ?? ''}
                            onChange={e => changeOwner(mb.id, e.target.value)}
                          >
                            <option value="">未割り当て</option>
                            {users.map(u => (
                              <option key={u.id} value={u.id}>{u.name}（{u.email}）</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Team: permissions toggle */}
                      {mb.type === 'team' && (
                        <div className="mt-3">
                          <button
                            onClick={() => isPermsOpen ? setExpandedPerms(null) : openPerms(mb)}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            <svg className={`w-3.5 h-3.5 transition-transform ${isPermsOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            アクセス権限を管理
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Permissions panel (team) */}
                    {isPermsOpen && mb.type === 'team' && (
                      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                        <p className="text-xs font-medium text-gray-500 mb-3">ユーザーごとのアクセス権限</p>
                        <div className="mb-3 rounded-lg border border-gray-200 overflow-hidden bg-white">
                          {/* Header */}
                          <div className="grid grid-cols-[1fr_56px_56px_72px] bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-400">
                            <div className="px-3 py-2">ユーザー</div>
                            <div className="py-2 text-center">閲覧</div>
                            <div className="py-2 text-center">返信</div>
                            <div className="py-2 text-center">担当変更</div>
                          </div>
                          {/* Rows */}
                          {users.map((u, i) => (
                            <div
                              key={u.id}
                              className={`grid grid-cols-[1fr_56px_56px_72px] items-center ${i !== 0 ? 'border-t border-gray-100' : ''} hover:bg-blue-50/40 transition-colors`}
                            >
                              <div className="px-3 py-2.5">
                                <p className="text-sm font-medium text-gray-800 truncate">{u.name}</p>
                                <p className="text-xs text-gray-400 truncate">{u.email}</p>
                              </div>
                              {(['can_view', 'can_reply', 'can_assign'] as const).map(key => (
                                <div key={key} className="flex items-center justify-center py-2.5">
                                  <label className="flex items-center justify-center w-full h-full cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={!!permsEdit[u.id]?.[key]}
                                      onChange={e => setPermsEdit(prev => ({
                                        ...prev,
                                        [u.id]: { ...prev[u.id], [key]: e.target.checked }
                                      }))}
                                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    />
                                  </label>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => savePerms(mb.id)} disabled={savingPerms} className="btn btn-primary btn-sm">
                            {savingPerms ? '保存中…' : '権限を保存'}
                          </button>
                          <button onClick={() => setExpandedPerms(null)} className="btn btn-secondary btn-sm">閉じる</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* User Management */}
      {tab === 'users' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setShowUserForm(v => !v); setEditingId(null); }} className="btn btn-primary btn-sm">
              {showUserForm ? 'キャンセル' : '+ ユーザー追加'}
            </button>
          </div>

          {/* New user form */}
          {showUserForm && (
            <div className="card p-5 border-blue-200 bg-blue-50/30">
              <h2 className="font-semibold text-gray-900 mb-4">新規ユーザー</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">名前</label>
                  <input className="input" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} placeholder="山田太郎" />
                </div>
                <div>
                  <label className="label">メールアドレス</label>
                  <input type="email" className="input" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} placeholder="taro@example.com" />
                </div>
                <div>
                  <label className="label">パスワード</label>
                  <input type="password" className="input" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} placeholder="8文字以上" />
                </div>
                <div>
                  <label className="label">権限</label>
                  <select className="select" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                    <option value="user">一般ユーザー</option>
                    <option value="admin">管理者</option>
                  </select>
                </div>
                <div>
                  <label className="label">Mattermost ユーザーID</label>
                  <input className="input" value={newUser.mattermost_user_id} onChange={e => setNewUser({ ...newUser, mattermost_user_id: e.target.value })} placeholder="例: s6ftom3jypgcuq7him9knzfo1a" />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={createUser} className="btn btn-primary btn-sm">作成</button>
                <button onClick={() => setShowUserForm(false)} className="btn btn-secondary btn-sm">キャンセル</button>
              </div>
            </div>
          )}

          {/* Edit user form */}
          {editingId && (
            <div className="card p-5 border-amber-200 bg-amber-50/30">
              <h2 className="font-semibold text-gray-900 mb-4">ユーザー編集</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">名前</label>
                  <input className="input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div>
                  <label className="label">メールアドレス</label>
                  <input type="email" className="input" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                </div>
                <div>
                  <label className="label">新しいパスワード（変更する場合のみ）</label>
                  <input type="password" className="input" value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} placeholder="8文字以上" />
                </div>
                <div>
                  <label className="label">権限</label>
                  <select className="select" value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}>
                    <option value="user">一般ユーザー</option>
                    <option value="admin">管理者</option>
                  </select>
                </div>
                <div>
                  <label className="label">Mattermost ユーザーID</label>
                  <input className="input" value={editForm.mattermost_user_id} onChange={e => setEditForm({ ...editForm, mattermost_user_id: e.target.value })} placeholder="例: s6ftom3jypgcuq7him9knzfo1a" />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={saveEdit} className="btn btn-primary btn-sm">保存</button>
                <button onClick={() => setEditingId(null)} className="btn btn-secondary btn-sm">キャンセル</button>
              </div>
            </div>
          )}

          {/* Users table */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">名前</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">メール</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">権限</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Mattermost ID</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => (
                  <tr key={u.id} className={editingId === u.id ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${
                        u.role === 'admin'
                          ? 'bg-purple-50 text-purple-700 ring-purple-200'
                          : 'bg-gray-100 text-gray-600 ring-gray-200'
                      }`}>
                        {u.role === 'admin' ? '管理者' : '一般'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">
                      {u.mattermost_user_id ? `@${u.mattermost_user_id}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => editingId === u.id ? setEditingId(null) : openEdit(u)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="編集"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteUser(u)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="削除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mailbox Settings Modal */}
      {showMbModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMbModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="font-semibold text-gray-900">
                {mbModalId ? 'メールアカウントを編集' : '新規メールアカウント'}
              </h2>
              <button onClick={() => setShowMbModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">種別</label>
                  <select value={mbForm.type} onChange={e => setMbForm(f => ({ ...f, type: e.target.value }))} className="select">
                    <option value="personal">個人メール</option>
                    <option value="team">チームメール</option>
                  </select>
                </div>
                <div>
                  <label className="label">表示名</label>
                  <input type="text" className="input" value={mbForm.display_name} onChange={e => setMbForm(f => ({ ...f, display_name: e.target.value }))} placeholder="営業チームメール" />
                </div>
                <div>
                  <label className="label">メールアドレス</label>
                  <input type="email" className="input" value={mbForm.email_address} onChange={e => setMbForm(f => ({ ...f, email_address: e.target.value }))} placeholder="sales@chart-inc.com" disabled={!!mbModalId} />
                </div>
                <div>
                  <label className="label">ユーザー名（IMAP/SMTP）</label>
                  <input type="text" className="input" value={mbForm.username} onChange={e => setMbForm(f => ({ ...f, username: e.target.value }))} />
                </div>
                <div>
                  <label className="label">
                    パスワード{mbModalId && <span className="text-xs text-gray-400 ml-1">（変更する場合のみ入力）</span>}
                  </label>
                  <input type="password" className="input" value={mbForm.password} onChange={e => setMbForm(f => ({ ...f, password: e.target.value }))} placeholder={mbModalId ? '変更しない場合は空欄' : ''} />
                </div>
                {mbForm.type === 'team' && (
                  <div className="md:col-span-2">
                    <label className="label">
                      Mattermost チャンネルID
                      <span className="text-xs text-gray-400 ml-1">（議論機能で使用）</span>
                    </label>
                    <input type="text" className="input font-mono text-sm" value={mbForm.mattermost_channel_id} onChange={e => setMbForm(f => ({ ...f, mattermost_channel_id: e.target.value }))} placeholder="例: s6ftom3jypgcuq7him9knzfo1a" />
                  </div>
                )}
                <div>
                  <label className="label">
                    受信同期モード
                    <span className="text-xs text-gray-400 ml-1">（IMAP IDLE対応サーバー推奨）</span>
                  </label>
                  <select value={mbForm.sync_mode} onChange={e => setMbForm(f => ({ ...f, sync_mode: e.target.value }))} className="select">
                    <option value="poll">ポーリング（定期確認）</option>
                    <option value="idle">IMAP IDLE（プッシュ通知）</option>
                  </select>
                  {mbForm.sync_mode === 'idle' && (
                    <p className="mt-1 text-xs text-blue-600">
                      サーバーから即時プッシュされます。IMAPサーバーがIDLEに対応している必要があります。
                    </p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <p className="text-sm font-semibold text-gray-700 mb-2">IMAP（受信）設定</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="label">ホスト</label>
                      <input type="text" className="input" value={mbForm.imap_host} onChange={e => setMbForm(f => ({ ...f, imap_host: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">ポート</label>
                      <input type="number" className="input" value={mbForm.imap_port} onChange={e => setMbForm(f => ({ ...f, imap_port: Number(e.target.value) }))} />
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={mbForm.imap_secure} onChange={e => setMbForm(f => ({ ...f, imap_secure: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <span className="text-sm text-gray-700">SSL/TLS</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <p className="text-sm font-semibold text-gray-700 mb-2">SMTP（送信）設定</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="label">ホスト</label>
                      <input type="text" className="input" value={mbForm.smtp_host} onChange={e => setMbForm(f => ({ ...f, smtp_host: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">ポート</label>
                      <input type="number" className="input" value={mbForm.smtp_port} onChange={e => setMbForm(f => ({ ...f, smtp_port: Number(e.target.value) }))} />
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={mbForm.smtp_secure} onChange={e => setMbForm(f => ({ ...f, smtp_secure: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <span className="text-sm text-gray-700">SSL/TLS</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
                <div>
                  {mbModalId && (
                    <button
                      onClick={() => { const mb = mailboxes.find(m => m.id === mbModalId); if (mb) deleteMailboxModal(mb); }}
                      className="btn btn-sm text-red-600 border border-red-200 hover:bg-red-50"
                    >
                      削除
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowMbModal(false)} className="btn btn-secondary btn-sm">キャンセル</button>
                  <button onClick={saveMailboxModal} disabled={mbSaving} className="btn btn-primary btn-sm">
                    {mbSaving ? '保存中…' : mbModalId ? '変更を保存' : '作成する'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[200px] text-gray-400">読み込み中…</div>}>
      <AdminSettingsContent />
    </Suspense>
  );
}
