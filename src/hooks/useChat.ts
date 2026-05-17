'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface ChatUser {
  userId: string;
  name: string;
  isOnline?: boolean;
}

export interface ChatReadReceipt {
  userId: string;
  readAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  body: string;
  kind: 'text' | 'sticker';
  createdAt: string;
  reads: ChatReadReceipt[];
  optimistic?: boolean;
}

interface InitData {
  me: { userId: string; name: string };
  participants: ChatUser[];
  messages: ChatMessage[];
}

export function useChat(threadId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<ChatUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<{ userId: string; name: string }[]>([]);
  const [me, setMe] = useState<{ userId: string; name: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReadRef = useRef<Set<string>>(new Set());
  const isOpenRef = useRef(false);
  const mountedRef = useRef(true);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || !threadId) return;
      await fetch(`/api/chat/${threadId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_ids: ids }),
      });
    },
    [threadId],
  );

  // Auto-read visible messages when panel is open
  const flushPendingReads = useCallback(() => {
    if (!isOpenRef.current) return;
    const ids = Array.from(pendingReadRef.current);
    if (ids.length === 0) return;
    pendingReadRef.current.clear();
    markRead(ids);
  }, [markRead]);

  const setOpen = useCallback(
    (open: boolean) => {
      isOpenRef.current = open;
      if (open) flushPendingReads();
    },
    [flushPendingReads],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!threadId) return;

    const es = new EventSource(`/api/chat/${threadId}/stream`);
    esRef.current = es;

    es.addEventListener('init', (e) => {
      if (!mountedRef.current) return;
      const data: InitData = JSON.parse(e.data);
      setMe(data.me);
      setParticipants(data.participants);
      setMessages(data.messages);
      setConnected(true);

      // Queue unread messages for read marking
      if (isOpenRef.current) {
        const unread = data.messages
          .filter(m => m.senderId !== data.me.userId && !m.reads.some(r => r.userId === data.me.userId))
          .map(m => m.id);
        if (unread.length) markRead(unread);
      } else {
        data.messages
          .filter(m => !m.reads.some(r => r.userId === data.me.userId))
          .forEach(m => pendingReadRef.current.add(m.id));
      }
    });

    es.addEventListener('chat_message', (e) => {
      if (!mountedRef.current) return;
      const msg: ChatMessage = JSON.parse(e.data);
      setMessages(prev => {
        // Replace optimistic if same sender+body within 5s, else append
        const idx = prev.findIndex(
          m => m.optimistic && m.senderId === msg.senderId && m.body === msg.body,
        );
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = msg;
          return next;
        }
        return [...prev, msg];
      });

      // Auto-read if panel open
      setMe(current => {
        if (current && msg.senderId !== current.userId) {
          if (isOpenRef.current) {
            markRead([msg.id]);
          } else {
            pendingReadRef.current.add(msg.id);
          }
        }
        return current;
      });
    });

    es.addEventListener('chat_typing', (e) => {
      if (!mountedRef.current) return;
      const { userId, name, isTyping } = JSON.parse(e.data);
      setTypingUsers(prev =>
        isTyping
          ? prev.some(u => u.userId === userId) ? prev : [...prev, { userId, name }]
          : prev.filter(u => u.userId !== userId),
      );
    });

    es.addEventListener('chat_read', (e) => {
      if (!mountedRef.current) return;
      const { userId, messageIds, readAt } = JSON.parse(e.data);
      setMessages(prev =>
        prev.map(m =>
          messageIds.includes(m.id) && !m.reads.some(r => r.userId === userId)
            ? { ...m, reads: [...m.reads, { userId, readAt }] }
            : m,
        ),
      );
    });

    es.addEventListener('chat_join', (e) => {
      if (!mountedRef.current) return;
      const { userId, name } = JSON.parse(e.data);
      setParticipants(prev =>
        prev.some(u => u.userId === userId) ? prev : [...prev, { userId, name }],
      );
    });

    es.addEventListener('chat_leave', (e) => {
      if (!mountedRef.current) return;
      const { userId } = JSON.parse(e.data);
      setParticipants(prev => prev.filter(u => u.userId !== userId));
    });

    es.onerror = () => {
      if (!mountedRef.current) return;
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [threadId, markRead]);

  const sendMessage = useCallback(
    async (body: string, kind: 'text' | 'sticker' = 'text') => {
      if (!threadId || !me) return;

      const optimistic: ChatMessage = {
        id: `opt-${Date.now()}`,
        threadId,
        senderId: me.userId,
        senderName: me.name,
        body,
        kind,
        createdAt: new Date().toISOString(),
        reads: [],
        optimistic: true,
      };
      setMessages(prev => [...prev, optimistic]);

      await fetch(`/api/chat/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, kind }),
      });
    },
    [threadId, me],
  );

  const notifyTyping = useCallback(() => {
    if (!threadId) return;
    fetch(`/api/chat/${threadId}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTyping: true }),
    });

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      fetch(`/api/chat/${threadId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: false }),
      });
    }, 2000);
  }, [threadId]);

  const loadMore = useCallback(async () => {
    if (!threadId || messages.length === 0) return;
    const oldest = messages[0];
    const res = await fetch(`/api/chat/${threadId}/messages?before=${oldest.id}&limit=50`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(prev => [...data.messages, ...prev]);
    setHasMore(data.hasMore);
  }, [threadId, messages]);

  return {
    messages,
    participants,
    typingUsers,
    me,
    connected,
    hasMore,
    sendMessage,
    notifyTyping,
    loadMore,
    setOpen,
  };
}
