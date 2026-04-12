'use client';
import { useEffect, useState, useCallback, useRef } from 'react';

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  department: string | null;
  notes: string | null;
  source: string;
};

const EMPTY: Omit<Contact, 'id' | 'source'> = { name: '', email: '', phone: '', company: '', department: '', notes: '' };

function ContactModal({ contact, onClose, onSave }: {
  contact: Partial<Contact> | null;
  onClose: () => void;
  onSave: (data: Omit<Contact, 'id' | 'source'>) => Promise<void>;
}) {
  const [form, setForm] = useState<Omit<Contact, 'id' | 'source'>>(
    contact ? { name: contact.name ?? '', email: contact.email ?? '', phone: contact.phone ?? '', company: contact.company ?? '', department: contact.department ?? '', notes: contact.notes ?? '' }
    : EMPTY
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(field: keyof typeof EMPTY) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('名前は必須です'); return; }
    setSaving(true);
    try { await onSave(form); } catch { setError('保存に失敗しました'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">{contact?.id ? '連絡先を編集' : '連絡先を追加'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="label">名前 <span className="text-red-500">*</span></label>
            <input className="input" value={form.name} onChange={set('name')} placeholder="山田 太郎" autoFocus />
          </div>
          <div>
            <label className="label">メールアドレス</label>
            <input className="input" type="email" value={form.email ?? ''} onChange={set('email')} placeholder="taro@example.com" />
          </div>
          <div>
            <label className="label">電話番号</label>
            <input className="input" value={form.phone ?? ''} onChange={set('phone')} placeholder="03-xxxx-xxxx" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">会社名</label>
              <input className="input" value={form.company ?? ''} onChange={set('company')} placeholder="株式会社〇〇" />
            </div>
            <div>
              <label className="label">部署</label>
              <input className="input" value={form.department ?? ''} onChange={set('department')} placeholder="営業部" />
            </div>
          </div>
          <div>
            <label className="label">メモ</label>
            <textarea className="input resize-none" rows={2} value={form.notes ?? ''} onChange={set('notes')} placeholder="備考など" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">キャンセル</button>
            <button type="submit" disabled={saving} className="btn btn-primary btn-sm">{saving ? '保存中…' : '保存'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [editing, setEditing] = useState<Contact | null | 'new'>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const spinnerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSpinner, setShowSpinner] = useState(false);

  const fetchContacts = useCallback(async (q = '') => {
    if (spinnerRef.current) clearTimeout(spinnerRef.current);
    spinnerRef.current = setTimeout(() => setShowSpinner(true), 200);
    const params = q ? `?q=${encodeURIComponent(q)}` : '';
    const res = await fetch(`/api/contacts${params}`);
    if (res.ok) {
      const d = await res.json();
      setContacts(d.contacts || []);
    }
    if (spinnerRef.current) clearTimeout(spinnerRef.current);
    setShowSpinner(false);
    setLoading(false);
  }, []);

  useEffect(() => { fetchContacts(); }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    fetchContacts(searchInput);
  }

  async function saveContact(data: Omit<Contact, 'id' | 'source'>) {
    if (editing === 'new') {
      const res = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error();
      setEditing(null);
      fetchContacts(search);
    } else if (editing) {
      const res = await fetch(`/api/contacts/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error();
      setEditing(null);
      fetchContacts(search);
    }
  }

  async function deleteContact(id: string) {
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    setContacts(c => c.filter(x => x.id !== id));
  }

  // Avatar initial
  function initials(name: string) {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  // Color from name
  const COLORS = ['bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-sky-100 text-sky-700'];
  function avatarColor(name: string) {
    return COLORS[name.charCodeAt(0) % COLORS.length];
  }

  return (
    <div className="space-y-4">
      {/* Modal */}
      {editing !== null && (
        <ContactModal
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={saveContact}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">連絡帳</h1>
          <p className="text-xs text-gray-500 mt-0.5">全員で共有する社内連絡帳</p>
        </div>
        <button onClick={() => setEditing('new')} className="btn btn-primary btn-sm gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          追加
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            placeholder="名前・メール・会社名で検索…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="input pl-9"
          />
        </div>
        <button type="submit" className="btn btn-secondary">検索</button>
        {search && (
          <button type="button" onClick={() => { setSearchInput(''); setSearch(''); fetchContacts(''); }} className="btn btn-secondary">クリア</button>
        )}
      </form>

      {/* Contact list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {showSpinner || loading ? (
          <div className="py-16 text-center">
            <div className="inline-block w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm text-gray-400">{search ? '見つかりませんでした' : '連絡先がありません。追加してください。'}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {contacts.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group">
                {/* Avatar */}
                <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${avatarColor(c.name)}`}>
                  {initials(c.name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                    {c.source === 'google' && (
                      <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">G</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-xs text-blue-600 hover:underline truncate" onClick={e => e.stopPropagation()}>
                        {c.email}
                      </a>
                    )}
                    {c.phone && <span className="text-xs text-gray-500">{c.phone}</span>}
                    {(c.company || c.department) && (
                      <span className="text-xs text-gray-400">{[c.company, c.department].filter(Boolean).join(' / ')}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditing(c)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="編集"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  {deleteConfirm === c.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-600">削除？</span>
                      <button onClick={() => deleteContact(c.id)} className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">はい</button>
                      <button onClick={() => setDeleteConfirm(null)} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">いいえ</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(c.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="削除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && contacts.length > 0 && (
        <p className="text-xs text-gray-400 text-right">{contacts.length} 件</p>
      )}
    </div>
  );
}

