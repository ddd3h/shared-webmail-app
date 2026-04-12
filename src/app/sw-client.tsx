'use client';
import { useEffect } from 'react';

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
  }, []);

  return null;
}
