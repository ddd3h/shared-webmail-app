'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type ScheduledSend = {
  id: string;
  mode: string;
  mailbox: { display_name: string; email_address: string } | null;
  to: string;
  subject: string;
  scheduled_at: string;
  created_at: string;
};

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('ja-JP', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const MODE_LABEL: Record<string, string> = {
  compose: '新規',
  reply: '返信',
  forward: '転送',
};

export default function ScheduledSendsPage() {
  const router = useRouter();
  const [items, setItems] = useState<ScheduledSend[]>([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string; href?: string; linkLabel?: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/scheduled-sends');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function flash(type: 'success' | 'error', text: string, extra?: { href: string; linkLabel: string }) {
    setMsg({ type, text, ...extra });
    setTimeout(() => setMsg(null), 6000);
  }

  async function cancel(id: string) {
    setCanceling(id);
    try {
      const res = await fetch(`/api/scheduled-sends/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setItems(prev => prev.filter(i => i.id !== id));
        const href = data.threadId ? `/threads/${data.threadId}?draft=${data.draftId}` : '/threads?tab=drafts';
        flash('success', '予約をキャンセルし、下書きに保存しました', { href, linkLabel: '下書きを開く' });
      } else {
        flash('error', 'キャンセルに失敗しました');
      }
    } finally {
      setCanceling(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">予約送信</h1>
        <p className="text-xs text-gray-500 mt-0.5">指定した日時に自動送信されるメールの一覧です</p>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          <span className="flex-1">{msg.text}</span>
          {msg.href && (
            <button onClick={() => router.push(msg.href!)} className="font-medium underline hover:no-underline flex-shrink-0">
              {msg.linkLabel}
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <div className="inline-block w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-gray-400">予約中のメールはありません</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map(item => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <span className="badge bg-blue-100 text-blue-700 flex-shrink-0">{MODE_LABEL[item.mode] || item.mode}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.subject || '(件名なし)'}</p>
                  <p className="text-xs text-gray-500 truncate">
                    宛先: {item.to}{item.mailbox ? ` ・ 差出人: ${item.mailbox.display_name}` : ''}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-xs font-medium text-gray-700">{formatDateTime(item.scheduled_at)}</p>
                  <button
                    onClick={() => cancel(item.id)}
                    disabled={canceling === item.id}
                    className="mt-1 text-xs text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
                  >
                    {canceling === item.id ? 'キャンセル中…' : 'キャンセル'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
