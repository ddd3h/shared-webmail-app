'use client';
import { useEffect } from 'react';
import useSWR from 'swr';
import { UNREAD_KEY, unreadFetcher } from '@/lib/unread-client';

// Keeps the PWA app badge equal to the unread total. The total is the shared unread-count entry, so it follows
// everything that changes it (reading a thread, marking unread, bulk actions); it is also asked again every minute
// and whenever the app comes back to the foreground.
export function useAppBadge() {
  const { data } = useSWR(UNREAD_KEY, unreadFetcher, { refreshInterval: 60_000, revalidateOnFocus: true });
  const total = data ? (data.personal || 0) + (data.team || 0) : null;

  useEffect(() => {
    if (total === null || !('setAppBadge' in navigator)) return;
    (total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => {}); // the Badge API is best-effort
  }, [total]);
}
