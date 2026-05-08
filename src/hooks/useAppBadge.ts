'use client';
import { useEffect } from 'react';

async function syncBadge() {
  if (!('setAppBadge' in navigator)) return;
  try {
    const res = await fetch('/api/threads/unread-counts');
    if (!res.ok) return;
    const { personal, team } = await res.json();
    const total = (personal || 0) + (team || 0);
    if (total > 0) {
      await navigator.setAppBadge(total);
    } else {
      await navigator.clearAppBadge();
    }
  } catch {}
}

// Syncs the PWA app badge with the current unread count.
// - On mount: sets badge to current unread total
// - On visibilitychange: refreshes when user returns to the tab
export function useAppBadge() {
  useEffect(() => {
    syncBadge();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncBadge();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}
