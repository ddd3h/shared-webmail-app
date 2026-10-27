'use client';
import { useEffect, useRef, useState } from 'react';
import { forgetDeviceLogin, isStandalone, rememberFlag, resumeWithDeviceKey } from '@/lib/device-key';

// Logs the person out after a while without any input (the length is the administrator's setting; 0 = off).
// "Input" is what the person does (keys, taps, mouse, scroll), not what the page does by itself (polling), so a tab left open does not stay logged in.
// The page also tells the server now and then (POST /api/auth/activity); the server ends a session that went quiet even if this page is gone (closed lid, closed tab).
const LAST_INPUT_KEY = 'last-input-at';   // shared by every tab of the app: working in one keeps the others alive
const SEND_EVERY_MS = 30_000;
const WARN_BEFORE_MS = 60_000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

const readShared = () => { try { return Number(localStorage.getItem(LAST_INPUT_KEY)) || 0; } catch { return 0; } };
const writeShared = (t: number) => { try { localStorage.setItem(LAST_INPUT_KEY, String(t)); } catch { /* storage blocked: this tab keeps its own time */ } };

export default function IdleLogout() {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null); // shown while the warning is up
  const idleMs = useRef(0);          // 0 = off
  const lastInput = useRef(0);       // set when the page is ready (Date.now() must not be read while the page is prepared in advance)
  const lastSent = useRef(0);
  const lastStored = useRef(0);
  const expired = useRef(false);
  const ending = useRef(false);

  useEffect(() => {
    const app = isStandalone() && rememberFlag(); // the installed app that stays logged in with its device key
    lastInput.current = Math.max(Date.now(), readShared());
    lastSent.current = Date.now();
    writeShared(lastInput.current);

    const learn = (minutes: unknown) => { idleMs.current = typeof minutes === 'number' && minutes > 0 ? minutes * 60_000 : 0; };
    fetch('/api/auth/session', { cache: 'no-store' }).then(r => r.json()).then(j => learn(j?.idle_minutes)).catch(() => {});

    async function endSession(reason?: 'idle') {
      if (ending.current) return;
      ending.current = true;
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      await forgetDeviceLogin();
      window.location.href = reason ? `/login?reason=${reason}` : '/login';
    }

    // The installed app does not show a login screen: when it was idle, it logs in again with its device key the next time it is used.
    async function comeBack() {
      expired.current = false;
      const res = await fetch('/api/auth/session', { cache: 'no-store' }).catch(() => null);
      if (!res) return;
      const j = await res.json().catch(() => null);
      if (j?.authenticated) { learn(j.idle_minutes); return; }
      const r = await resumeWithDeviceKey();
      if (r === 'ok') window.location.reload();
      else if (r === 'refused') await endSession();
    }

    async function heartbeat() {
      lastSent.current = Date.now();
      const res = await fetch('/api/auth/activity', { method: 'POST' }).catch(() => null);
      if (!res) return; // offline
      if (res.status === 401) { if (app) void comeBack(); else await endSession(); return; }
      if (res.ok) learn((await res.json().catch(() => null))?.idle_minutes);
    }

    function onInput() {
      const now = Date.now();
      lastInput.current = now;
      if (now - lastStored.current > 2_000) { lastStored.current = now; writeShared(now); }
      setSecondsLeft(null);
      if (expired.current) { void comeBack(); return; }
      if (idleMs.current > 0 && now - lastSent.current > SEND_EVERY_MS) void heartbeat();
    }

    function tick() {
      if (idleMs.current === 0 || ending.current) { setSecondsLeft(null); return; }
      const quiet = Date.now() - Math.max(lastInput.current, readShared());
      if (quiet >= idleMs.current) {
        setSecondsLeft(null);
        if (app) expired.current = true; else void endSession('idle');
      } else if (quiet >= idleMs.current - WARN_BEFORE_MS && !app) {
        setSecondsLeft(Math.ceil((idleMs.current - quiet) / 1000));
      } else {
        setSecondsLeft(null);
      }
    }

    const timer = window.setInterval(tick, 1000);
    for (const e of INPUT_EVENTS) window.addEventListener(e, onInput, { capture: true, passive: true });
    document.addEventListener('visibilitychange', tick); // after a sleep the timer has not run: check the clock at once
    return () => {
      window.clearInterval(timer);
      for (const e of INPUT_EVENTS) window.removeEventListener(e, onInput, { capture: true });
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  if (secondsLeft === null) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="idle-title" className="text-base font-semibold text-gray-900">まもなくログアウトします</h2>
        <p className="mt-2 text-sm text-gray-600">しばらく操作がないため、あと <strong className="tabular-nums">{secondsLeft}</strong> 秒で自動的にログアウトします。</p>
        <button type="button" className="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700" onClick={() => { lastInput.current = Date.now(); writeShared(lastInput.current); setSecondsLeft(null); void fetch('/api/auth/activity', { method: 'POST' }); }}>
          ログインを続ける
        </button>
      </div>
    </div>
  );
}
