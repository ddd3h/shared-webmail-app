'use client';
import { useState } from 'react';
import useSWR from 'swr';

type SpamSender = {
  id: string;
  type: string;
  address: string;
  note: string | null;
  created_at: string;
  creator: { name: string };
};

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function AdminSpamPage() {
  const { data, mutate } = useSWR<{ items: SpamSender[] }>('/api/admin/spam-senders', fetcher);
  const [activeTab, setActiveTab] = useState<'whitelist' | 'blocklist'>('blocklist');
  const [newAddress, setNewAddress] = useState('');
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const items = (data?.items || []).filter(i => i.type === activeTab);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const address = newAddress.trim().toLowerCase();
    if (!address) return;
    setAdding(true);
    setError('');
    const res = await fetch('/api/admin/spam-senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: activeTab, address, note: newNote.trim() || null })
    });
    setAdding(false);
    if (res.ok) {
      setNewAddress('');
      setNewNote('');
      mutate();
      showToast('追加しました');
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || '追加に失敗しました');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('削除しますか？')) return;
    const res = await fetch(`/api/admin/spam-senders/${id}`, { method: 'DELETE' });
    if (res.ok) { mutate(); showToast('削除しました'); }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-bold text-gray-900 mb-6">迷惑メール送信者管理</h1>

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">{toast}</div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {(['blocklist', 'whitelist'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'blocklist' ? 'ブロックリスト' : 'ホワイトリスト'}
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-500 mb-4">
        {activeTab === 'blocklist'
          ? 'このリストのアドレス・ドメインからのメールは自動で迷惑メール扱いになります。'
          : 'このリストのアドレス・ドメインは迷惑メール判定をスキップします。Spamhausに登録されていても無視されます。'}
      </p>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newAddress}
          onChange={e => setNewAddress(e.target.value)}
          placeholder="メールアドレス or ドメイン (例: spam.com)"
          className="flex-1 input text-sm"
        />
        <input
          type="text"
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="メモ（任意）"
          className="w-36 input text-sm"
        />
        <button
          type="submit"
          disabled={adding || !newAddress.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {adding ? '追加中…' : '追加'}
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {/* List */}
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">登録なし</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">アドレス / ドメイン</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">メモ</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">登録者</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">日時</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-gray-900">{item.address}</td>
                  <td className="px-4 py-3 text-gray-500">{item.note || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{item.creator.name}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(item.created_at).toLocaleDateString('ja-JP')}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
