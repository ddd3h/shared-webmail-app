'use client';
import { useEffect } from 'react';

async function updateAppBadge() {
  if (!('setAppBadge' in navigator)) return;
  try {
    const res = await fetch('/api/threads/unread-counts');
    if (!res.ok) return;
    const { personal, team } = await res.json();
    const total = personal + team;
    if (total > 0) {
      await (navigator as any).setAppBadge(total);
    } else {
      await (navigator as any).clearAppBadge();
    }
  } catch {
    // Badge API is best-effort; ignore errors
  }
}

async function registerPushSubscription(registration: ServiceWorkerRegistration) {
  try {
    if (!('PushManager' in self) && !('PushManager' in window)) return;

    const existing = await registration.pushManager.getSubscription();
    if (existing) return;

    const res = await fetch('/api/push/vapid-public-key').catch(() => null);
    if (!res?.ok) return;

    const { publicKey } = await res.json().catch(() => ({}));
    if (!publicKey) return;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey
    });

    const sub = subscription.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: sub.keys,
        platform: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios'
          : /Android/.test(navigator.userAgent) ? 'android' : 'desktop',
        userAgent: navigator.userAgent
      })
    });
  } catch (e) {
    console.debug('[SW] Push subscription failed:', e);
  }
}

export default function SWClient() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.debug('[SW] Registered:', registration.scope);

        // Handle SW updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              console.debug('[SW] Updated to new version');
            }
          });
        });

        // Auto-subscribe if permission already granted
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          registerPushSubscription(registration);
        }
      })
      .catch((err) => {
        console.debug('[SW] Registration failed:', err);
      });

    // Update app badge on load and whenever the app comes to the foreground
    updateAppBadge();
    const onVisible = () => { if (document.visibilityState === 'visible') updateAppBadge(); };
    document.addEventListener('visibilitychange', onVisible);

    // Poll every 60 seconds while the app is open
    const timer = setInterval(updateAppBadge, 60_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);

  return null;
}
