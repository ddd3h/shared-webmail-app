const STALE_MS = 45_000;
const TYPING_TTL_MS = 4_000;

export type ChatUser = {
  userId: string;
  name: string;
};

type Connection = ChatUser & {
  controller: ReadableStreamDefaultController;
  lastSeen: number;
};

type SSEEvent = {
  event: string;
  data: unknown;
};

// In-memory store: threadId → userId → Connection
const store = new Map<string, Map<string, Connection>>();
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function send(conn: Connection, evt: SSEEvent) {
  try {
    const chunk = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
    conn.controller.enqueue(new TextEncoder().encode(chunk));
  } catch {
    // connection closed
  }
}

export function joinChat(
  threadId: string,
  userId: string,
  name: string,
  controller: ReadableStreamDefaultController,
): ChatUser {
  if (!store.has(threadId)) store.set(threadId, new Map());
  const room = store.get(threadId)!;
  const conn: Connection = { userId, name, controller, lastSeen: Date.now() };
  room.set(userId, conn);
  broadcastChat(threadId, { event: 'chat_join', data: { userId, name } }, userId);
  return { userId, name };
}

export function leaveChat(threadId: string, userId: string) {
  const room = store.get(threadId);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) store.delete(threadId);
  else broadcastChat(threadId, { event: 'chat_leave', data: { userId } });
}

export function broadcastChat(threadId: string, evt: SSEEvent, excludeUserId?: string) {
  const room = store.get(threadId);
  if (!room) return;
  const now = Date.now();
  for (const [uid, conn] of room) {
    if (uid === excludeUserId) continue;
    if (now - conn.lastSeen > STALE_MS) { room.delete(uid); continue; }
    send(conn, evt);
  }
}

export function getChatUsers(threadId: string): ChatUser[] {
  const room = store.get(threadId);
  if (!room) return [];
  return [...room.values()].map(({ userId, name }) => ({ userId, name }));
}

export function heartbeatChat(threadId: string, userId: string) {
  const conn = store.get(threadId)?.get(userId);
  if (conn) conn.lastSeen = Date.now();
}

export function setTyping(threadId: string, userId: string, name: string) {
  const key = `${threadId}:${userId}`;
  // Reset auto-clear timer
  const existing = typingTimers.get(key);
  if (existing) clearTimeout(existing);

  broadcastChat(threadId, { event: 'chat_typing', data: { userId, name, isTyping: true } }, userId);

  const timer = setTimeout(() => {
    typingTimers.delete(key);
    broadcastChat(threadId, { event: 'chat_typing', data: { userId, name, isTyping: false } }, userId);
  }, TYPING_TTL_MS);
  typingTimers.set(key, timer);
}

export function clearTyping(threadId: string, userId: string, name: string) {
  const key = `${threadId}:${userId}`;
  const existing = typingTimers.get(key);
  if (existing) { clearTimeout(existing); typingTimers.delete(key); }
  broadcastChat(threadId, { event: 'chat_typing', data: { userId, name, isTyping: false } }, userId);
}
