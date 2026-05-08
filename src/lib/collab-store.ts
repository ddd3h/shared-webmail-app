const STALE_MS = 45_000;

export type CollabUser = {
  userId: string;
  name: string;
  color: string;
};

type Connection = CollabUser & {
  controller: ReadableStreamDefaultController;
  lastSeen: number;
};

type SSEEvent = {
  event: string;
  data: unknown;
};

// In-memory store: threadId → userId → Connection
const store = new Map<string, Map<string, Connection>>();

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f97316', '#8b5cf6', '#ec4899'];

function pickColor(threadId: string, userId: string): string {
  const users = store.get(threadId);
  const used = new Set(users ? [...users.values()].map(c => c.color) : []);
  return COLORS.find(c => !used.has(c)) ?? COLORS[userId.charCodeAt(0) % COLORS.length];
}

function send(conn: Connection, evt: SSEEvent) {
  try {
    const chunk = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
    conn.controller.enqueue(new TextEncoder().encode(chunk));
  } catch {
    // connection closed
  }
}

export function join(
  threadId: string,
  userId: string,
  name: string,
  controller: ReadableStreamDefaultController,
): CollabUser {
  if (!store.has(threadId)) store.set(threadId, new Map());
  const room = store.get(threadId)!;

  const color = room.get(userId)?.color ?? pickColor(threadId, userId);
  const conn: Connection = { userId, name, color, controller, lastSeen: Date.now() };
  room.set(userId, conn);

  broadcast(threadId, { event: 'join', data: { userId, name, color } }, userId);
  return { userId, name, color };
}

export function leave(threadId: string, userId: string) {
  const room = store.get(threadId);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) store.delete(threadId);
  else broadcast(threadId, { event: 'leave', data: { userId } });
}

export function broadcast(threadId: string, evt: SSEEvent, excludeUserId?: string) {
  const room = store.get(threadId);
  if (!room) return;
  const now = Date.now();
  for (const [uid, conn] of room) {
    if (uid === excludeUserId) continue;
    if (now - conn.lastSeen > STALE_MS) { room.delete(uid); continue; }
    send(conn, evt);
  }
}

export function getUsers(threadId: string): CollabUser[] {
  const room = store.get(threadId);
  if (!room) return [];
  return [...room.values()].map(({ userId, name, color }) => ({ userId, name, color }));
}

export function heartbeat(threadId: string, userId: string) {
  store.get(threadId)?.get(userId) && (store.get(threadId)!.get(userId)!.lastSeen = Date.now());
}
