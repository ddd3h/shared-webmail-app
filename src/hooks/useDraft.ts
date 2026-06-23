'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

export type DraftData = {
  mailbox_id?: string;
  thread_id?: string;
  to_raw?: string;
  cc_raw?: string;
  bcc_raw?: string;
  subject?: string;
  html_body?: string;
  text_body?: string;
  is_shared?: boolean;
};

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export type DraftConflict = {
  serverUpdatedAt: string;
  updatedByName: string | null;
};

const DEBOUNCE_MS = 1000;

export function useDraft(initialDraftId?: string, isShared?: boolean) {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId || null);
  const [status, setStatus] = useState<DraftStatus>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<DraftData | null>(null);
  const savingRef = useRef(false);
  const draftIdRef = useRef<string | null>(initialDraftId || null);
  const mountedRef = useRef(true);
  const serverUpdatedAtRef = useRef<string | null>(null);
  const lastTypedAtRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Follow externally-resolved draftId (e.g. ComposeForm resolves the shared
  // collaborative draft after mount). Without this the hook would keep its
  // initial null and POST a new (duplicate) draft on first save.
  useEffect(() => {
    if (initialDraftId && initialDraftId !== draftIdRef.current) {
      draftIdRef.current = initialDraftId;
      setDraftId(initialDraftId);
    }
  }, [initialDraftId]);

  const saveNow = useCallback(async (data: DraftData): Promise<string | null> => {
    if (savingRef.current) return draftIdRef.current;
    savingRef.current = true;
    if (mountedRef.current) setStatus('saving');
    try {
      let id = draftIdRef.current;
      if (id) {
        const body: Record<string, unknown> = { ...data };
        // Shared collaborative drafts skip optimistic locking: the body is merged
        // by Yjs (CRDT) and the /yjs persist endpoint bumps updated_at constantly,
        // which would make client_updated_at perpetually stale and 409 forever.
        if (serverUpdatedAtRef.current && !isShared) body.client_updated_at = serverUpdatedAtRef.current;
        const res = await fetch(`/api/drafts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          const json = await res.json();
          if (mountedRef.current) {
            setStatus('conflict');
            setConflict({ serverUpdatedAt: json.server_updated_at, updatedByName: json.updated_by_name });
          }
          return id;
        }
        if (!res.ok) { if (mountedRef.current) setStatus('error'); return id; }
        const json = await res.json();
        serverUpdatedAtRef.current = json.updated_at;
        if (mountedRef.current) { setStatus('saved'); setSavedAt(new Date()); setConflict(null); }
      } else {
        const res = await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) { if (mountedRef.current) setStatus('error'); return null; }
        const json = await res.json();
        id = json.id;
        draftIdRef.current = id ?? null;
        if (json.updated_at) serverUpdatedAtRef.current = json.updated_at;
        if (mountedRef.current) { setDraftId(id ?? null); setStatus('saved'); setSavedAt(new Date()); }
      }
      return id || null;
    } catch {
      if (mountedRef.current) setStatus('error');
      return draftIdRef.current;
    } finally {
      savingRef.current = false;
    }
  }, [isShared]);

  const scheduleSave = useCallback((data: DraftData) => {
    lastTypedAtRef.current = Date.now();
    pendingRef.current = data;
    if (mountedRef.current) setStatus('idle');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (mountedRef.current && pendingRef.current) {
        saveNow(pendingRef.current);
        pendingRef.current = null;
      }
    }, DEBOUNCE_MS);
  }, [saveNow]);

  const stripBodyFromPending = useCallback(() => {
    if (pendingRef.current) {
      delete pendingRef.current.html_body;
      delete pendingRef.current.text_body;
    }
  }, []);

  const deleteDraft = useCallback(async () => {
    const id = draftIdRef.current;
    if (!id) return;
    await fetch(`/api/drafts/${id}`, { method: 'DELETE' }).catch(() => {});
    draftIdRef.current = null;
    if (mountedRef.current) { setDraftId(null); setStatus('idle'); }
  }, []);

  const initServerTimestamp = useCallback((iso: string) => {
    serverUpdatedAtRef.current = iso;
  }, []);

  const dismissConflict = useCallback(() => setConflict(null), []);

  return {
    draftId,
    status,
    savedAt,
    conflict,
    scheduleSave,
    saveNow,
    deleteDraft,
    stripBodyFromPending,
    initServerTimestamp,
    dismissConflict,
  };
}
