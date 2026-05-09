'use client';
import { useEffect, useRef, useState } from 'react';

const DELAY_MS = 4000;

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SendingOverlay({ onConfirm, onCancel }: Props) {
  const [remaining, setRemaining] = useState(DELAY_MS);
  const doneRef = useRef(false);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const left = Math.max(0, DELAY_MS - (Date.now() - start));
      setRemaining(left);
      if (left === 0) {
        clearInterval(id);
        if (!doneRef.current) { doneRef.current = true; onConfirm(); }
      }
    }, 50);
    return () => clearInterval(id);
  }, [onConfirm]);

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }

  const secs = Math.ceil(remaining / 1000);
  const progress = (DELAY_MS - remaining) / DELAY_MS;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-white/95 backdrop-blur-sm">
      {/* Paper plane flight lane */}
      <div className="relative w-full h-24 overflow-hidden mb-8 flex items-center">
        <div className="animate-plane-fly absolute left-0 top-1/2 -translate-y-1/2">
          <svg width="64" height="64" viewBox="0 0 24 24" className="text-blue-500 drop-shadow-md" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </div>
      </div>

      {/* Text */}
      <p className="text-xl font-bold text-gray-800 mb-1">送信中…</p>
      <p className="text-sm text-gray-400 mb-5">{secs} 秒後に送信されます</p>

      {/* Progress bar */}
      <div className="w-56 h-1 bg-gray-100 rounded-full overflow-hidden mb-6">
        <div
          className="h-full bg-blue-500 rounded-full"
          style={{ width: `${progress * 100}%`, transition: 'width 50ms linear' }}
        />
      </div>

      {/* Cancel */}
      <button
        onClick={cancel}
        className="px-8 py-2.5 rounded-full text-sm font-semibold bg-gray-900 text-white hover:bg-gray-700 active:scale-95 transition-all"
      >
        送信をキャンセル
      </button>
    </div>
  );
}
