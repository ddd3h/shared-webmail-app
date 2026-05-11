'use client';
import type { DraftStatus } from '@/hooks/useDraft';

export default function DraftStatusBar({ status, savedAt }: { status: DraftStatus; savedAt: Date | null }) {
  if (status === 'idle') return null;

  const time = savedAt ? savedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <span className="text-xs flex items-center gap-1">
      {status === 'saving' && (
        <span className="text-gray-400 flex items-center gap-1">
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          下書き保存中…
        </span>
      )}
      {status === 'saved' && (
        <span className="text-emerald-600 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          下書き保存済 {time}
        </span>
      )}
      {status === 'error' && (
        <span className="text-red-500">下書き保存失敗</span>
      )}
    </span>
  );
}
