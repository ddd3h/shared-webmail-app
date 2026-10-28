// Passkey rules, and how long ago somebody last logged in (the admin people list).
//
// - Somebody with a passkey logs in with it; the password no longer works for them (an administrator's reset removes the passkey,
//   which brings the password login back).
// - One passkey per person. People who already have more get a notice to keep one (nothing is deleted for them).

export const MAX_PASSKEYS = 1;

export const passwordLoginAllowed = (passkeyCount: number): boolean => passkeyCount === 0;
export const canRegisterPasskey = (passkeyCount: number): boolean => passkeyCount < MAX_PASSKEYS;
export const needsPasskeyCleanup = (passkeyCount: number): boolean => passkeyCount > MAX_PASSKEYS;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the date; null when there is no date. */
export function daysSince(date: Date | null, now: Date = new Date()): number | null {
  return date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS)) : null;
}

export function lastLoginLabel(date: Date | null, now: Date = new Date()): string {
  const days = daysSince(date, now);
  return days === null ? 'ログイン記録なし' : days === 0 ? '今日' : `${days}日前`;
}

/** The newer of two dates (either may be missing). */
export function latestDate(a: Date | null, b: Date | null): Date | null {
  return !a ? b : !b ? a : a.getTime() >= b.getTime() ? a : b;
}
