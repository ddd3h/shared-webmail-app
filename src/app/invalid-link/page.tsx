'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function InvalidLinkContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  const messages: Record<string, { title: string; detail: string }> = {
    expired: {
      title: '有効期限切れ',
      detail: 'このリンクはセキュリティ保護のため有効期限が切れています。再度リクエストを行ってください。'
    },
    used: {
      title: '使用済みリンク',
      detail: 'このリンクは既に一度使用されているか、処理が完了しています。'
    },
    invalid: {
      title: '無効なリンク',
      detail: 'リンクが正しくないか、既に削除されています。'
    },
    default: {
      title: 'アクセスできません',
      detail: 'このリンクは無効または期限切れです。'
    }
  };

  const content = messages[reason || 'default'] || messages.default;

  return (
    <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-2 ring-8 ring-rose-50/50">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      
      <div>
        <h1 className="text-xl font-bold text-gray-900">{content.title}</h1>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed px-4">
          {content.detail}
        </p>
      </div>

      <div className="pt-2">
        <button 
          onClick={() => window.close()}
          className="btn btn-primary w-full justify-center py-3 shadow-lg shadow-blue-100 font-bold"
        >
          この画面を閉じる
        </button>
      </div>
    </div>
  );
}

export default function InvalidLinkPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="card p-10 w-full max-w-sm shadow-xl bg-white rounded-[2rem]">
        <Suspense fallback={<div className="text-center text-sm text-gray-400">読み込み中…</div>}>
          <InvalidLinkContent />
        </Suspense>
      </div>
    </div>
  );
}
