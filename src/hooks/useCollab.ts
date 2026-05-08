'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';

export type CollabUser = {
  userId: string;
  name: string;
  color: string;
};

export type UseCollabReturn = {
  doc: Y.Doc | null;
  awareness: Awareness | null;
  connected: boolean;
  me: CollabUser | null;
  activeUsers: CollabUser[];
};

export function useCollab(sessionId: string | undefined): UseCollabReturn {
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState<CollabUser | null>(null);
  const [activeUsers, setActiveUsers] = useState<CollabUser[]>([]);
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);

  const docRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const pendingUpdateRef = useRef<boolean>(false);

  const postOp = useCallback(
    async (body: unknown) => {
      if (!sessionId) return;
      await fetch(`/api/collab/${sessionId}/op`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [sessionId],
  );

  useEffect(() => {
    if (!sessionId) return;

    const ydoc = new Y.Doc();
    const aw = new Awareness(ydoc);
    docRef.current = ydoc;
    awarenessRef.current = aw;
    setDoc(ydoc);
    setAwareness(aw);

    // Send Yjs doc updates to server (micro-batched)
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      if (pendingUpdateRef.current) return;
      pendingUpdateRef.current = true;
      Promise.resolve().then(() => {
        pendingUpdateRef.current = false;
        postOp({ type: 'update', update: Buffer.from(update).toString('base64') });
      });
    });

    // Send awareness changes to server
    aw.on('change', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) return;
      // Only broadcast if the local client is among the changed clients
      if (!changed.includes(ydoc.clientID)) return;
      const update = encodeAwarenessUpdate(aw, [ydoc.clientID]);
      postOp({ type: 'awareness', awareness: Buffer.from(update).toString('base64') });
    });

    const es = new EventSource(`/api/collab/${sessionId}/stream`);

    es.addEventListener('init', (e) => {
      const data = JSON.parse(e.data);
      setMe(data.me);
      setActiveUsers(data.activeUsers);

      // yCursorPlugin reads user info from aw.user; cursor position is managed separately
      aw.setLocalStateField('user', { name: data.me.name, color: data.me.color });

      if (data.yjsState) {
        const bytes = Uint8Array.from(atob(data.yjsState), c => c.charCodeAt(0));
        Y.applyUpdate(ydoc, bytes, 'remote');
      }
      setConnected(true);
    });

    es.addEventListener('update', (e) => {
      const { update } = JSON.parse(e.data);
      const bytes = Uint8Array.from(atob(update), c => c.charCodeAt(0));
      Y.applyUpdate(ydoc, bytes, 'remote');
    });

    es.addEventListener('awareness', (e) => {
      const { awareness: encoded } = JSON.parse(e.data);
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      applyAwarenessUpdate(aw, bytes, 'remote');
    });

    es.addEventListener('join', (e) => {
      const user: CollabUser = JSON.parse(e.data);
      setActiveUsers(prev =>
        prev.find(u => u.userId === user.userId) ? prev : [...prev, user],
      );
    });

    es.addEventListener('leave', (e) => {
      const { userId } = JSON.parse(e.data);
      setActiveUsers(prev => prev.filter(u => u.userId !== userId));
    });

    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      aw.destroy();
      ydoc.destroy();
      docRef.current = null;
      awarenessRef.current = null;
      setDoc(null);
      setAwareness(null);
      setConnected(false);
    };
  }, [sessionId, postOp]);

  return { doc, awareness, connected, me, activeUsers };
}
