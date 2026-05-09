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

const DEBOUNCE_MS = 1500;

export function useDraft(initialDraftId?: string) {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId || null);
  const [status, setStatus] = useState<DraftStatus>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<DraftData | null>(null);
  const savingRef = useRef(false);

  // Clean up timer on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const saveNow = useCallback(async (data: DraftData): Promise<string | null> => {
    if (savingRef.current) return draftId;
    savingRef.current = true;
    setStatus('saving');
    try {
      let id = draftId;
      if (id) {
        // Update existing draft
        const res = await fetch(`/api/drafts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) { setStatus('error'); return id; }
      } else {
        // Create new draft
        const res = await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) { setStatus('error'); return null; }
        const json = await res.json();
        id = json.id;
        setDraftId(id);
      }
      setStatus('saved');
      setSavedAt(new Date());
      return id || null;
    } catch {
      setStatus('error');
      return draftId;
    } finally {
      savingRef.current = false;
    }
  }, [draftId]);

  // Schedule a debounced save
  const scheduleSave = useCallback((data: DraftData) => {
    pendingRef.current = data;
    setStatus('idle');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (pendingRef.current) saveNow(pendingRef.current);
    }, DEBOUNCE_MS);
  }, [saveNow]);

  // Delete the draft (e.g., after successful send)
  const deleteDraft = useCallback(async () => {
    if (!draftId) return;
    await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' }).catch(() => {});
    setDraftId(null);
    setStatus('idle');
  }, [draftId]);

  return { draftId, status, savedAt, scheduleSave, saveNow, deleteDraft };
}
