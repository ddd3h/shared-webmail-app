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

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1000;

export function useDraft(initialDraftId?: string) {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId || null);
  const [status, setStatus] = useState<DraftStatus>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<DraftData | null>(null);
  const savingRef = useRef(false);
  // Ref mirrors draftId state so saveNow always reads the latest value
  // without re-creating the callback (eliminates stale-closure duplicate-POST bug).
  const draftIdRef = useRef<string | null>(initialDraftId || null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const saveNow = useCallback(async (data: DraftData): Promise<string | null> => {
    if (savingRef.current) return draftIdRef.current;
    savingRef.current = true;
    if (mountedRef.current) setStatus('saving');
    try {
      let id = draftIdRef.current;
      if (id) {
        const res = await fetch(`/api/drafts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) { if (mountedRef.current) setStatus('error'); return id; }
      } else {
        const res = await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) { if (mountedRef.current) setStatus('error'); return null; }
        const json = await res.json();
        id = json.id;
        draftIdRef.current = id ?? null;
        if (mountedRef.current) setDraftId(id ?? null);
      }
      if (mountedRef.current) { setStatus('saved'); setSavedAt(new Date()); }
      return id || null;
    } catch {
      if (mountedRef.current) setStatus('error');
      return draftIdRef.current;
    } finally {
      savingRef.current = false;
    }
  }, []); // no deps — reads draftId via draftIdRef, not closure

  const scheduleSave = useCallback((data: DraftData) => {
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

  return { draftId, status, savedAt, scheduleSave, saveNow, deleteDraft, stripBodyFromPending };
}
