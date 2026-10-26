// The unread count lives in one place in the browser (an SWR entry), so everything that shows it - the tabs of the mail
// list and the app icon badge - changes together. Whatever alters what is unread calls refreshMail() once it is saved.
import { mutate } from 'swr';

export const UNREAD_KEY = '/api/threads/unread-counts';

export const unreadFetcher = async (url: string): Promise<{ personal: number; team: number }> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

/** Ask the server again for the unread counts and every mail list that is on screen. */
export const refreshMail = () => mutate(key => typeof key === 'string' && key.startsWith('/api/threads'));
