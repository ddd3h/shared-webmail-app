'use client';
import { useEffect } from 'react';
import { rememberFlag, forgetDeviceLogin, resumeWithDeviceKey } from '@/lib/device-key';

const CHECK_EVERY_MS = 30_000;

// The installed app stays open in the background for days. When it comes back to the front after its session ended
// (idle time, a different network address), it logs in again with its device key and reloads - the person sees no login screen.
// Only runs for an app that was set to stay logged in.
export default function SessionKeeper() {
  useEffect(() => {
    let last = 0;
    async function check() {
      if (document.visibilityState !== 'visible' || !rememberFlag() || Date.now() - last < CHECK_EVERY_MS) return;
      last = Date.now();
      const res = await fetch('/api/auth/session', { cache: 'no-store' }).catch(() => null);
      if (!res) return; // offline: try again next time
      const alive = res.ok && !res.redirected && (await res.json().catch(() => null))?.authenticated === true;
      if (alive) return;
      const r = await resumeWithDeviceKey();
      if (r === 'ok') { window.location.reload(); return; }
      if (r === 'refused') { await forgetDeviceLogin(); window.location.href = '/login'; }
    }
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    void check();
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, []);
  return null;
}
