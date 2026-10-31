'use client';
import { useEffect } from 'react';
import { isStandalone, rememberFlag } from '@/lib/device-key';

// When the server says the session is over (401 from the app's own API), the person is taken to the login screen at once, remembering where they
// were (the login brings them back). Without this a screen whose session ended while it was open stays on screen with an empty list or an error.
// Every fetch of the page passes through here, so no screen has to handle it separately.
//
// Not counted: the login steps themselves (/api/auth/*: a 401 there is an ordinary "wrong password" / "no device key"), which have their own handling.
const IGNORED = ['/api/auth/', '/api/passkeys/auth', '/api/profile/password-reset', '/api/cron/'];

function appApiPath(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin || !u.pathname.startsWith('/api/')) return null;
    return u.pathname;
  } catch { return null; }
}

export default function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;
    let leaving = false;
    function toLogin() {
      if (leaving) return;
      leaving = true;
      const q = new URLSearchParams({ from: window.location.pathname + window.location.search });
      // the installed app that stays logged in logs in again by itself on the login screen (with its device key): no message needed
      if (!(isStandalone() && rememberFlag())) q.set('reason', 'expired');
      window.location.assign(`/login?${q}`);
    }
    window.fetch = async function guarded(input: RequestInfo | URL, init?: RequestInit) {
      const res = await original.call(window, input, init);
      if (res.status === 401) {
        const path = appApiPath(input);
        if (path && !IGNORED.some(p => path.startsWith(p))) toLogin();
      }
      return res;
    };
    return () => { window.fetch = original; };
  }, []);
  return null;
}
