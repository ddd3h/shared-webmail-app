'use client';
import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then(r => r.json());

type AffectedMailbox = {
  name: string;
  email: string;
  count: number;
};

function ApproveActionForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  const { data: request, error } = useSWR(id ? `/api/admin/approve-action?id=${id}` : null, fetcher);

  useEffect(() => {
    if (error) {
      router.replace('/invalid-link?reason=invalid');
      return;
    }
    if (request && request.error) {
      router.replace('/invalid-link?reason=used');
      return;
    }
  }, [request, error, router]);

  useEffect(() => {
    if (!request?.expires_at || result) return;

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(request.expires_at).getTime();
      const diff = end - now;

      if (diff <= 0) {
        clearInterval(timer);
        setTimeLeft('0:00');
        setIsExpired(true);
        router.replace('/invalid-link?reason=expired');
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [request?.expires_at, result, router]);

  async function handleApprove() {
    if (!id || isExpired) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/approve-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: `${data.requesterName} さんによる削除リクエストを承認しました。` });
      } else {
        if (data.error === 'expired') {
          router.replace('/invalid-link?reason=expired');
        } else {
          setResult({ success: false, message: '承認に失敗しました。' });
        }
      }
    } catch (e) {
      setResult({ success: false, message: '通信エラーが発生しました。' });
    } finally {
      setLoading(false);
    }
  }

  if (!id) return null;
  if (!request && !result) return <div className="text-center text-sm text-gray-400 animate-pulse">リクエストを確認中…</div>;

  if (result) {
    return (
      <div className="text-center space-y-4 animate-in fade-in zoom-in duration-300">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${result.success ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
          {result.success ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          )}
        </div>
        <h1 className="text-lg font-bold text-gray-900">{result.success ? '承認完了' : 'エラー'}</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{result.message}</p>
        <button onClick={() => window.close()} className="btn btn-secondary w-full py-2">画面を閉じる</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="text-center">
        <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900">大量削除の承認</h1>
        <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-bold">Approval Request</p>
      </div>

      <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100 space-y-4">
        <div className="flex justify-between items-center text-sm border-b border-gray-200/60 pb-3">
          <span className="text-gray-400 font-medium text-xs">申請者</span>
          <span className="text-gray-900 font-bold">{request.user?.name}</span>
        </div>
        
        <div>
          <span className="text-gray-400 font-medium text-[10px] uppercase tracking-wider block mb-2">対象メールアカウント</span>
          <div className="space-y-2 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
            {(request.affectedMailboxes as AffectedMailbox[] || []).map((mb, i) => (
              <div key={i} className="flex justify-between items-start gap-3 bg-white p-2 rounded-lg border border-gray-200/50 shadow-sm">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-800 truncate">{mb.name}</p>
                  <p className="text-[10px] text-gray-400 truncate">{mb.email}</p>
                </div>
                <span className="text-xs font-mono font-bold text-rose-600 shrink-0">{mb.count}件</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-center text-sm border-t border-gray-200/60 pt-3">
          <span className="text-gray-400 font-medium text-xs">合計件数</span>
          <span className="text-rose-600 font-extrabold">{request.count} 件</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-400 font-medium text-xs">承認期限</span>
          <span className={`font-mono font-bold ${isExpired ? 'text-red-500' : 'text-amber-600 animate-pulse'}`}>
            {timeLeft || '--:--'}
          </span>
        </div>
      </div>

      <div className="text-center px-2">
        <p className="text-xs text-gray-500 leading-relaxed">
          この操作を承認すると、上記アカウント内の対象メールは<span className="text-rose-600 font-bold">永久に削除</span>されます。<br />復元することはできません。
        </p>
      </div>

      <div className="pt-2 space-y-3">
        <button
          onClick={handleApprove}
          disabled={loading || isExpired}
          className="btn btn-primary w-full justify-center py-3 shadow-lg shadow-blue-100 font-bold disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
        >
          {isExpired ? '有効期限切れ' : loading ? '処理中…' : '承認して永久削除を実行'}
        </button>
        <button
          onClick={() => window.close()}
          className="w-full text-center text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          キャンセルして閉じる
        </button>
      </div>
    </div>
  );
}

export default function ApproveActionPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="card p-8 w-full max-w-sm shadow-xl bg-white rounded-[2rem]">
        <Suspense fallback={<div className="text-center text-sm text-gray-400">読み込み中…</div>}>
          <ApproveActionForm />
        </Suspense>
      </div>
    </div>
  );
}
