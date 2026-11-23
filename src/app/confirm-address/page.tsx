'use client';
import { Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import AddressCheck, { type AddressResult } from '@/components/AddressCheck';
import { safeFrom } from '@/lib/safe-redirect';

// A page opened from an address the session was not proved from lands here (the proxy sends it): the person confirms it is them, then goes on
// to the page they were opening. (The screens of the app ask in a dialog instead, see SessionGuard.)
function ConfirmAddress() {
  const params = useSearchParams();
  const from = safeFrom(params.get('from'));
  const done = useCallback((r: AddressResult) => {
    if (r === 'ok') { window.location.replace(from); return; }
    window.location.replace(`/login?${new URLSearchParams({ from, reason: 'expired' })}`);
  }, [from]);
  return <AddressCheck onDone={done} />;
}

export default function ConfirmAddressPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="card p-8 w-full max-w-sm shadow-xl bg-white rounded-4xl">
        <h1 className="mb-4 text-lg font-bold text-gray-900">本人確認</h1>
        <Suspense fallback={<div className="text-sm text-gray-400">読み込み中…</div>}>
          <ConfirmAddress />
        </Suspense>
      </div>
    </div>
  );
}
