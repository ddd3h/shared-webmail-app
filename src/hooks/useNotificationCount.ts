'use client';
import useSWR, { mutate } from 'swr';

// The number on the bell: unread notifications. One shared entry, so the bell and the list change together.
export const NOTIFICATION_COUNT_KEY = '/api/notifications/unread-count';

const fetcher = async (url: string): Promise<number> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()).count ?? 0;
};

export function useNotificationCount(): number {
  const { data } = useSWR(NOTIFICATION_COUNT_KEY, fetcher, { refreshInterval: 60_000, revalidateOnFocus: true });
  return data ?? 0;
}

export const setNotificationCount = (n: number) => mutate(NOTIFICATION_COUNT_KEY, n, { revalidate: false });
