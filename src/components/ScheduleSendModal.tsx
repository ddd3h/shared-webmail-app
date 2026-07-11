'use client';
import { useState } from 'react';

type Props = {
  initialValue?: string; // datetime-local string ("YYYY-MM-DDTHH:mm")
  initialError?: string;
  onConfirm: (value: string) => void;
  onClear?: () => void;
  onClose: () => void;
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitValue(v: string): [string, string] {
  const [date, time] = v.split('T');
  return [date || '', time || ''];
}

const QUICK_OPTIONS: { label: string; get: () => Date }[] = [
  { label: '1時間後', get: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: '3時間後', get: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
  {
    label: '今夜 19:00',
    get: () => {
      const d = new Date();
      d.setHours(19, 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      return d;
    },
  },
  {
    label: '明日 9:00',
    get: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: '明日 18:00',
    get: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
      return d;
    },
  },
  {
    label: '来週月曜 9:00',
    get: () => {
      const d = new Date();
      const add = ((8 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + add);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

export default function ScheduleSendModal({ initialValue, initialError, onConfirm, onClear, onClose }: Props) {
  const [value, setValue] = useState(initialValue || '');
  const [error, setError] = useState(initialError || '');
  const [date, time] = splitValue(value);

  function setDate(d: string) {
    setValue(`${d}T${time || '09:00'}`);
    setError('');
  }
  function setTime(t: string) {
    setValue(`${date || toLocalInput(new Date()).split('T')[0]}T${t}`);
    setError('');
  }
  function applyQuick(get: () => Date) {
    setValue(toLocalInput(get()));
    setError('');
  }

  function confirm() {
    if (!value) { setError('日時を選択してください'); return; }
    const when = new Date(value);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      setError('未来の日時を指定してください');
      return;
    }
    onConfirm(value);
  }

  const minDate = toLocalInput(new Date()).split('T')[0];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600">
          <div className="flex items-center gap-2 text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="font-semibold text-sm">送信日時を指定</h2>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-1 rounded hover:bg-white/10 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Quick picks */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">よく使う日時</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => applyQuick(opt.get)}
                  className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date / time pickers */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">日付</label>
              <input
                type="date"
                value={date}
                min={minDate}
                onChange={e => setDate(e.target.value)}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">時刻</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="input text-sm"
              />
            </div>
          </div>

          {value && !error && (
            <p className="text-sm text-center font-medium text-blue-700 bg-blue-50 rounded-lg py-2.5 px-2">
              {new Date(value).toLocaleString('ja-JP', {
                year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
              })} に送信
            </p>
          )}
          {error && <p className="text-xs text-red-600 text-center">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-5 py-3 bg-gray-50 border-t border-gray-100">
          {onClear && (
            <button type="button" onClick={onClear} className="text-xs text-gray-500 hover:text-gray-700 transition-colors self-start">
              予約を解除
            </button>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-w-0 px-3 py-2 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              キャンセル
            </button>
            <button type="button" onClick={confirm} className="flex-1 min-w-0 btn btn-primary btn-sm">
              設定する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
