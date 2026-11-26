// Who is in a shared draft, read from the awareness states of the room (see RichEditor).
//
// The awareness 'change' event fires on every caret move of every person (each one's caret position is part of its
// state), so it fires on every keystroke. The list of people is the same nearly every time. The editor tells its
// parent only when the list really changed (collabSignature), so typing does not redraw the whole compose screen.

export type CollabUser = { clientId: number; name: string; color: string; id?: string };

/** The people in the room, once each (the same person in two tabs counts once, by user id). */
export function collabUsersFromStates(states: Map<number, unknown>): CollabUser[] {
  const seen = new Set<string>();
  const users: CollabUser[] = [];
  states.forEach((state, clientId) => {
    const u = (state as { user?: { name?: string; color?: string; id?: string } } | null)?.user;
    if (!u) return;
    const key = u.id ?? `c${clientId}`;
    if (seen.has(key)) return;
    seen.add(key);
    users.push({ clientId, name: u.name ?? 'ユーザー', color: u.color ?? '#888', id: u.id });
  });
  return users;
}

/** Everything the avatars show (and their React keys), so two lists with the same signature look the same on screen. */
export const collabSignature = (users: CollabUser[]) => users.map(u => `${u.clientId}|${u.id ?? ''}|${u.name}|${u.color}`).join('\n');
