'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import dynamic from 'next/dynamic';
import type { RichEditorHandle, CollabUser } from './RichEditor';
import { useDraft, type DraftData } from '@/hooks/useDraft';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@/lib/attachment-limits';
import DraftStatusBar from './DraftStatus';
import EmailChipInput from './EmailChipInput';
import SendingOverlay from './SendingOverlay';
import ScheduleSendModal from './ScheduleSendModal';

const RichEditor = dynamic(() => import('./RichEditor'), { ssr: false });

// Yjs and y-websocket — loaded lazily (client only, shared drafts only)
let YLib: typeof import('yjs') | null = null;
let WebsocketProviderClass: (typeof import('y-websocket'))['WebsocketProvider'] | null = null;
let IndexeddbPersistenceClass: (typeof import('y-indexeddb'))['IndexeddbPersistence'] | null = null;
let AwarenessClass: (typeof import('y-protocols/awareness'))['Awareness'] | null = null;

async function loadYjsLibs() {
  if (!YLib) {
    const [yjs, websocket, indexeddb, awareness] = await Promise.all([
      import('yjs'),
      import('y-websocket'),
      import('y-indexeddb'),
      import('y-protocols/awareness'),
    ]);
    YLib = yjs;
    WebsocketProviderClass = websocket.WebsocketProvider;
    IndexeddbPersistenceClass = indexeddb.IndexeddbPersistence;
    AwarenessClass = awareness.Awareness;
  }
  return { Y: YLib!, WebsocketProvider: WebsocketProviderClass!, IndexeddbPersistence: IndexeddbPersistenceClass!, Awareness: AwarenessClass! };
}

type YDoc = import('yjs').Doc;
type YAwareness = import('y-protocols/awareness').Awareness;

// Central collaboration server URL (y-websocket). Resolution order:
//   1. explicit NEXT_PUBLIC_COLLAB_WS_URL
//   2. derived from NEXT_PUBLIC_APP_URL when it's https (→ wss://<host>/collab)
//   3. localhost dev fallback
// This lets production work from just the existing .env (NEXT_PUBLIC_APP_URL).
const COLLAB_WS_URL = (() => {
  if (process.env.NEXT_PUBLIC_COLLAB_WS_URL) return process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  const app = process.env.NEXT_PUBLIC_APP_URL || '';
  if (app.startsWith('https://')) {
    return app.replace(/^https:\/\//, 'wss://').replace(/\/+$/, '') + '/collab';
  }
  return 'ws://localhost:1234';
})();

export type ComposeMode = 'compose' | 'reply' | 'forward';

export type DraftAttachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
};

export type SendPayload = {
  mailboxId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  // Attachments live on the draft server-side; the send routes copy them off it.
  draftAttachmentIds: string[];
};

export interface ComposeFormProps {
  mode: ComposeMode;
  defaultMailboxId?: string;
  initialTo?: string[];
  initialCc?: string[];
  initialBcc?: string[];
  initialSubject?: string;
  initialBody?: string;
  quote?: { header: string; html: string } | null;
  draftId?: string;
  threadId?: string;
  onSend: (payload: SendPayload) => Promise<string | null>;
  onSchedule?: (payload: SendPayload, scheduledAt: Date) => Promise<string | null>;
  onCancel: () => void;
  minBodyHeight?: number;
}

type Mailbox = { id: string; display_name: string; email_address: string; type: string };
type ReplyUser = { id: string; name: string; signature: string };

export default function ComposeForm({
  mode,
  defaultMailboxId,
  initialTo = [],
  initialCc = [],
  initialBcc = [],
  initialSubject = '',
  initialBody = '',
  quote = null,
  draftId,
  threadId,
  onSend,
  onSchedule,
  onCancel,
  minBodyHeight,
}: ComposeFormProps) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [mailboxesLoaded, setMailboxesLoaded] = useState(false);
  const [selectedMailbox, setSelectedMailbox] = useState(defaultMailboxId || '');
  const [toChips, setToChips] = useState<string[]>(initialTo);
  const [ccChips, setCcChips] = useState<string[]>(initialCc);
  const [bccChips, setBccChips] = useState<string[]>(initialBcc);
  const [showCc, setShowCc] = useState(initialCc.length > 0);
  const [showBcc, setShowBcc] = useState(initialBcc.length > 0);
  const [subject, setSubject] = useState(initialSubject);
  const [savedAtts, setSavedAtts] = useState<DraftAttachment[]>([]);
  const [attachError, setAttachError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sigVisible, setSigVisible] = useState(true);
  const [signature, setSignature] = useState('');
  const [showSigPicker, setShowSigPicker] = useState(false);
  const sigPickerRef = useRef<HTMLDivElement>(null);
  const [showQuote, setShowQuote] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [editorBody, setEditorBody] = useState(initialBody);
  const [newContactEmails, setNewContactEmails] = useState<string[]>([]);
  const [replyUsers, setReplyUsers] = useState<ReplyUser[]>([]);

  const editorRef = useRef<RichEditorHandle>(null);
  const richContentRef = useRef(initialBody);
  // Last attachment revision this client is known to be in sync with — see
  // bumpAttachmentRev()/the attRev effect for how collaborators stay aligned.
  const attRevRef = useRef(0);

  // Yjs collaborative editing state (shared team drafts only).
  // The doc (and the presence of who is here) exists from the moment a shared mailbox is chosen, and the editor is bound to it from the start;
  // the room on the collaboration server is joined later, once the draft has an id. The editor is never rebuilt when that happens,
  // so nothing typed in between is lost and the caret stays where it is.
  const [ydoc, setYdoc] = useState<YDoc | null>(null);
  const [awareness, setAwareness] = useState<YAwareness | null>(null);
  const [yjsProvider, setYjsProvider] = useState<import('y-websocket').WebsocketProvider | null>(null);
  const [displayName, setDisplayName] = useState('ユーザー');
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const colorRef = useRef('#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'));
  const currentUser = useMemo(() => ({ name: displayName, color: colorRef.current, id: userId }), [displayName, userId]);
  const [collaborators, setCollaborators] = useState<CollabUser[]>([]);

  const selectedMb = mailboxes.find(m => m.id === selectedMailbox);
  const isTeam = selectedMb?.type === 'team';
  // A shared mailbox is edited together (Yjs). Changing From can switch this on or off: the text typed so far is
  // carried across the switch (carryRef) instead of being lost when the editor is rebuilt.
  const collab = isTeam;
  const carryRef = useRef<string | null>(null);
  // the body of an old shared draft saved only as HTML (from before the body was kept in Yjs): put into the empty doc once
  const legacySeedRef = useRef<string | null>(null);

  // For team replies, all participants must share ONE draft (= one Yjs room).
  // resolvedDraftId starts from the prop and, for team replies without one, is
  // filled by find-or-create below so everyone converges on the same draft id.
  const [resolvedDraftId, setResolvedDraftId] = useState<string | undefined>(draftId);
  const draft = useDraft(resolvedDraftId, collab);

  // Ensure a single shared draft exists for this team reply, then adopt its id.
  useEffect(() => {
    if (!collab || resolvedDraftId || mode !== 'reply' || !threadId || !selectedMailbox) return;
    let cancelled = false;
    fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox_id: selectedMailbox, thread_id: threadId, is_shared: true }),
    })
      .then(r => r.json())
      .then(j => { if (!cancelled && j?.id) setResolvedDraftId(j.id); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [collab, resolvedDraftId, mode, threadId, selectedMailbox]);

  const selectedSigUser = useMemo(
    () => replyUsers.find(u => u.signature === signature) ?? null,
    [replyUsers, signature],
  );

  // Fetch mailboxes and signature on mount
  useEffect(() => {
    fetch('/api/mailboxes?mine=1')
      .then(r => r.json())
      .then(d => {
        const items: Mailbox[] = (d.items || []).filter((m: any) => m.user_permissions?.can_reply !== false);
        setMailboxes(items);
        setSelectedMailbox(prev => prev || defaultMailboxId || items[0]?.id || '');
      })
      .catch(() => {})
      .finally(() => setMailboxesLoaded(true));
    fetch('/api/user/signature')
      .then(r => r.json())
      .then(d => {
        const sig = d.signature ?? (d.name ? `${d.name}${d.email ? '\n' + d.email : ''}` : '');
        if (sig) setSignature(sig);
        if (d.name) setDisplayName(d.name); // collaboration cursor label
      })
      .catch(() => {});
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(d => { if (d.user?.userId) setUserId(d.user.userId); }) // for presence avatars
      .catch(() => {});
  }, []);

  // Fetch reply-capable users and their signatures for team mailboxes
  useEffect(() => {
    if (!selectedMailbox || !isTeam) { setReplyUsers([]); return; }
    fetch(`/api/mailboxes/${selectedMailbox}/reply-users`)
      .then(r => r.json())
      .then((users: ReplyUser[]) => { if (Array.isArray(users)) setReplyUsers(users); })
      .catch(() => {});
  }, [selectedMailbox, isTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showSigPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (sigPickerRef.current && !sigPickerRef.current.contains(e.target as Node)) {
        setShowSigPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSigPicker]);

  // Load draft data once per draft id. It must not run again when the Yjs doc appears or goes away
  // (From changed): that would overwrite what was typed since with the older saved copy.
  const loadedDraftRef = useRef<string | null>(null);
  // true once the saved draft (and its saved Yjs state) has been read, or when there is none to read
  const [draftReady, setDraftReady] = useState(!resolvedDraftId);
  // The editor appears once From is known (plain or shared editor) and, when an existing draft was opened, once it has been read.
  // Latched: a draft id that turns up later (the shared reply's draft) must not take the editor away while someone is typing.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (!booted && mailboxesLoaded && (!draftId || draftReady)) setBooted(true);
  }, [booted, mailboxesLoaded, draftId, draftReady]);
  // the shared editing library could not be loaded (a stale page after an update, a network error): a plain editor, saved as HTML
  const [yjsFailed, setYjsFailed] = useState(false);
  const sharedEditor = collab && !yjsFailed;
  const editorReady = booted && (!sharedEditor || (!!ydoc && !!awareness));
  // what a new shared doc starts with: the text carried over from the plain editor (From changed), an old draft's HTML body,
  // or the body a new message starts with (a forwarded message) while there is no draft (no room) yet
  const collabSeed = sharedEditor ? (carryRef.current ?? legacySeedRef.current ?? (!draft.draftId && initialBody ? initialBody : null)) : null;
  // the signature of the person who made a shared draft: what it starts with, whoever opens it
  const [creatorSig, setCreatorSig] = useState<string | null>(null);
  const ydocRef = useRef<typeof ydoc>(null);
  ydocRef.current = ydoc;
  const yjsStateRef = useRef<string | null>(null);
  const appliedDocRef = useRef<unknown>(null);
  // a change made here that the server does not have yet, and the function that saves it soon (see the save effect)
  const yjsUnsavedRef = useRef(false);
  const scheduleYjsSaveRef = useRef<(() => void) | null>(null);
  // how far the server's copy of the current doc is known to reach (a Yjs state vector): a save sends only what is newer,
  // so a pasted picture is not sent again with every keystroke
  const savedSVRef = useRef<{ draftId: string | null; sv: Uint8Array } | null>(null);

  // Apply the saved Yjs state to a doc, once per doc. (A merge: whatever is already in the doc stays.)
  function applyYjsState(Y: typeof import('yjs'), doc: YDoc | null) {
    if (!doc || !yjsStateRef.current || appliedDocRef.current === doc) return;
    appliedDocRef.current = doc;
    const binary = Uint8Array.from(atob(yjsStateRef.current), c => c.charCodeAt(0));
    Y.applyUpdate(doc, binary);
    // the server has at least this much: later saves send only what came after it
    if (!savedSVRef.current) savedSVRef.current = { draftId: loadedDraftRef.current, sv: Y.encodeStateVectorFromUpdate(binary) };
  }

  useEffect(() => {
    if (!resolvedDraftId || loadedDraftRef.current === resolvedDraftId) return;
    loadedDraftRef.current = resolvedDraftId;
    setDraftReady(false);
    fetch(`/api/drafts/${resolvedDraftId}`)
      .then(r => r.json())
      .then(async d => {
        if (!d.id) { loadedDraftRef.current = null; setDraftReady(true); return; } // gone (sent, deleted): start empty
        if (d.to_raw) setToChips(d.to_raw.split(/[,;]\s*/).map((s: string) => s.trim()).filter(Boolean));
        if (d.cc_raw) {
          const cc = d.cc_raw.split(/[,;]\s*/).map((s: string) => s.trim()).filter(Boolean);
          setCcChips(cc);
          if (cc.length) setShowCc(true);
        }
        if (d.bcc_raw) {
          const bcc = d.bcc_raw.split(/[,;]\s*/).map((s: string) => s.trim()).filter(Boolean);
          setBccChips(bcc);
          if (bcc.length) setShowBcc(true);
        }
        if (d.subject) setSubject(d.subject);
        if (d.mailbox_id) setSelectedMailbox(d.mailbox_id);
        if (Array.isArray(d.attachments)) setSavedAtts(d.attachments);
        if (d.updated_at) draft.initServerTimestamp(d.updated_at);

        if (typeof d.creator_signature === 'string' && d.creator_signature) setCreatorSig(d.creator_signature);
        yjsStateRef.current = d.yjs_state_b64 || null;
        if (d.html_body && !d.yjs_state_b64) {
          setEditorBody(d.html_body);
          richContentRef.current = d.html_body;
          if (d.is_shared) legacySeedRef.current = d.html_body;
        }
        if (ydocRef.current) applyYjsState((await loadYjsLibs()).Y, ydocRef.current);
        setDraftReady(true);
      })
      .catch(() => { loadedDraftRef.current = null; setDraftReady(true); });
  }, [resolvedDraftId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The shared doc: made as soon as a shared mailbox is chosen (and thrown away when From leaves it).
  // What was saved before is put in before the editor is bound to it, so the editor starts with it.
  useEffect(() => {
    if (!collab) return;
    let alive = true;
    let doc: YDoc | null = null;
    let aw: YAwareness | null = null;
    loadYjsLibs().then(({ Y, Awareness }) => {
      if (!alive) return;
      doc = new Y.Doc();
      aw = new Awareness(doc);
      savedSVRef.current = null;
      ydocRef.current = doc; // a draft read that finishes before the next render applies its saved state here too
      applyYjsState(Y, doc);
      // every change made here (typing, the signature, ...) is to be saved; changes that arrive from elsewhere were saved by their author
      doc.on('update', (_u: Uint8Array, _origin: unknown, _d: YDoc, tr: { local: boolean }) => {
        if (!tr.local) return;
        yjsUnsavedRef.current = true;
        scheduleYjsSaveRef.current?.();
      });
      setYdoc(doc);
      setAwareness(aw);
    }).catch(() => { if (alive) setYjsFailed(true); });
    return () => {
      alive = false;
      aw?.destroy();
      doc?.destroy();
      setYdoc(null);
      setAwareness(null);
    };
  }, [collab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Join the draft's room once the draft has an id: the collaboration server (live editing together) and this
  // browser's own copy (IndexedDB). Both only merge into the doc the editor is already bound to.
  useEffect(() => {
    if (!ydoc || !awareness || !draft.draftId) return;
    const roomId = `webmail-draft-${draft.draftId}`;
    let alive = true;
    let provider: import('y-websocket').WebsocketProvider | null = null;
    let persistence: import('y-indexeddb').IndexeddbPersistence | null = null;
    loadYjsLibs().then(({ WebsocketProvider, IndexeddbPersistence }) => {
      if (!alive) return;
      try {
        provider = new WebsocketProvider(COLLAB_WS_URL, roomId, ydoc, { awareness });
      } catch {
        return;
      }
      persistence = new IndexeddbPersistence(roomId, ydoc);
      setYjsProvider(provider);
    }).catch(() => {});
    return () => {
      alive = false;
      provider?.destroy();
      persistence?.destroy();
      setYjsProvider(null);
    };
  }, [ydoc, awareness, draft.draftId]);

  // Save the shared body to the server a moment after it is changed here, and when the composer closes or the page goes away.
  // The server merges what it gets into what it has, so a save never drops what someone else wrote.
  useEffect(() => {
    if (!ydoc || !draft.draftId) return;
    const draftId = draft.draftId;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstUnsavedAt = 0;
    const flush = (leaving = false) => {
      if (timer) clearTimeout(timer);
      timer = null;
      firstUnsavedAt = 0;
      if (!yjsUnsavedRef.current || !YLib) return;
      yjsUnsavedRef.current = false;
      const Y = YLib;
      const sv = Y.encodeStateVector(ydoc);
      const base = savedSVRef.current?.draftId === draftId ? savedSVRef.current.sv : null;
      // only what the server does not have yet (it merges it into what it has)
      const state = base ? Y.encodeStateAsUpdate(ydoc, base) : Y.encodeStateAsUpdate(ydoc);
      const done = () => { if (ydocRef.current === ydoc) savedSVRef.current = { draftId, sv }; };
      const url = `/api/drafts/${draftId}/yjs`;
      // a page that is going away: the browser sends a beacon even after the page is gone (a normal request would be cut off)
      if (leaving && navigator.sendBeacon?.(url, new Blob([state.buffer as ArrayBuffer], { type: 'application/octet-stream' }))) { done(); return; }
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: state.buffer as ArrayBuffer,
        keepalive: leaving && state.byteLength < 60_000,
      }).then(r => { if (r.ok) done(); else yjsUnsavedRef.current = true; }).catch(() => { yjsUnsavedRef.current = true; });
    };
    // 2 seconds after the last change, and at least every 10 seconds while someone keeps typing
    const schedule = () => {
      const now = Date.now();
      if (!firstUnsavedAt) firstUnsavedAt = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => flush(), now - firstUnsavedAt > 8_000 ? 0 : 2_000);
    };
    scheduleYjsSaveRef.current = schedule;
    if (yjsUnsavedRef.current) schedule(); // typed before the draft had an id
    // leaving: the tab is hidden (switched away, closed, the phone locked) or the page is unloaded
    const onHide = () => flush(true);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(true); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      scheduleYjsSaveRef.current = null;
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [ydoc, draft.draftId]);

  // Sync signature selection + visibility across collaborators via Yjs meta map.
  useEffect(() => {
    if (!ydoc) return;
    const meta = ydoc.getMap('meta');
    const apply = () => {
      const s = meta.get('signature');
      const v = meta.get('sigVisible');
      if (typeof s === 'string') setSignature(s);
      if (typeof v === 'boolean') setSigVisible(v);
    };
    apply();
    meta.observe(apply);
    return () => meta.unobserve(apply);
  }, [ydoc]);

  // Refetch the attachment list when a collaborator adds or removes one. Only the
  // revision counter travels through Yjs; the list comes from the server so every
  // client sees the same rows and ids.
  useEffect(() => {
    if (!ydoc || !draft.draftId) return;
    const meta = ydoc.getMap('meta');
    const draftId = draft.draftId;
    const apply = () => {
      const rev = Number(meta.get('attRev')) || 0;
      if (rev === attRevRef.current) return; // our own bump, already applied
      attRevRef.current = rev;
      fetch(`/api/drafts/${draftId}/attachments`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => { if (j && Array.isArray(j.attachments)) setSavedAtts(j.attachments); })
        .catch(() => {});
    };
    meta.observe(apply);
    return () => meta.unobserve(apply);
  }, [ydoc, draft.draftId]);

  // Seed the shared signature once, with the signature of the person who made the draft (shown as its author),
  // so everyone sees the same one instead of their own personal default. A later change is shared through the same key.
  // Only after what is already saved has arrived (the saved draft and the room's state), so nothing already chosen is overwritten.
  useEffect(() => {
    const initial = creatorSig ?? signature;
    if (!ydoc || !initial || !draftReady || !yjsProvider) return;
    const meta = ydoc.getMap('meta');
    const seed = () => { if (meta.get('signature') === undefined) meta.set('signature', initial); };
    if (yjsProvider.synced) { seed(); return; }
    const t = setTimeout(seed, 3000); // collaboration server unreachable: use our own
    const onSync = () => { clearTimeout(t); seed(); };
    yjsProvider.once('sync', onSync);
    return () => { clearTimeout(t); yjsProvider.off('sync', onSync); };
  }, [ydoc, yjsProvider, signature, creatorSig, draftReady]);

  // Update signature locally AND broadcast to collaborators (shared drafts).
  function syncSignature(sig: string | null, visible: boolean) {
    if (sig !== null) setSignature(sig);
    setSigVisible(visible);
    if (ydoc) {
      const meta = ydoc.getMap('meta');
      if (sig !== null) meta.set('signature', sig);
      meta.set('sigVisible', visible);
    }
  }

  function draftPayload(overrides: { to?: string[]; cc?: string[]; bcc?: string[]; subject?: string } = {}): DraftData {
    const resolvedTo = overrides.to ?? toChips;
    const resolvedCc = overrides.cc ?? ccChips;
    const resolvedBcc = overrides.bcc ?? bccChips;
    const resolvedSubject = overrides.subject ?? subject;
    return {
      mailbox_id: selectedMailbox || undefined,
      thread_id: mode === 'reply' ? threadId : undefined,
      to_raw: resolvedTo.join(', '),
      cc_raw: resolvedCc.join(', ') || undefined,
      bcc_raw: resolvedBcc.join(', ') || undefined,
      subject: resolvedSubject,
      // For Yjs-backed team drafts the body is synced via the collab server and
      // persisted through /api/drafts/[id]/yjs — sending html_body here too would
      // race with the optimistic lock and cause 409s. Omit body when ydoc is active.
      html_body: sharedEditor ? undefined : editorRef.current?.getHTML(),
      text_body: sharedEditor ? undefined : editorRef.current?.getText(),
      is_shared: collab,
    };
  }

  function saveDraft(overrides: { to?: string[]; cc?: string[]; bcc?: string[]; subject?: string } = {}) {
    draft.scheduleSave(draftPayload(overrides));
  }

  // Tells collaborators on a shared draft that the attachment list changed. The
  // list itself isn't in the Y.Doc — only this counter, which triggers a refetch.
  function bumpAttachmentRev() {
    if (!ydoc) return;
    const meta = ydoc.getMap('meta');
    const next = (Number(meta.get('attRev')) || 0) + 1;
    attRevRef.current = next;
    meta.set('attRev', next);
  }

  const ATTACH_ERRORS: Record<string, string> = {
    file_too_large: `1ファイルあたり${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB以内にしてください`,
    too_many_files: `添付ファイルは${MAX_ATTACHMENTS}件までです`,
    forbidden: 'この下書きに添付する権限がありません',
    not_found: '下書きが見つかりません',
  };

  // Attachments are uploaded to the draft immediately rather than held in memory,
  // so closing the composer never loses them.
  async function addFiles(list: File[]) {
    if (list.length === 0) return;
    const oversized = list.filter(f => f.size > MAX_ATTACHMENT_BYTES);
    if (oversized.length > 0) { setAttachError(`「${oversized[0].name}」は${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MBを超えています`); return; }
    if (savedAtts.length + list.length > MAX_ATTACHMENTS) { setAttachError(`添付ファイルは${MAX_ATTACHMENTS}件までです`); return; }
    setAttachError('');
    setUploading(true);
    try {
      const id = await draft.ensureDraftId(draftPayload());
      if (!id) { setAttachError('下書きを保存できなかったため添付できません'); return; }
      const fd = new FormData();
      list.forEach(f => fd.append('file', f));
      const res = await fetch(`/api/drafts/${id}/attachments`, { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setAttachError(ATTACH_ERRORS[json.error] || '添付のアップロードに失敗しました'); return; }
      setSavedAtts(json.attachments || []);
      bumpAttachmentRev();
    } catch {
      setAttachError('添付のアップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(attId: string) {
    const id = draft.draftId;
    if (!id) return;
    setAttachError('');
    try {
      const res = await fetch(`/api/drafts/${id}/attachments/${attId}`, { method: 'DELETE' });
      if (!res.ok) { setAttachError('添付の削除に失敗しました'); return; }
      const json = await res.json().catch(() => ({}));
      setSavedAtts(json.attachments || []);
      bumpAttachmentRev();
    } catch {
      setAttachError('添付の削除に失敗しました');
    }
  }

  const dragHandlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); void addFiles(Array.from(e.dataTransfer.files)); },
  };

  function validate() {
    if (!toChips.length) return '宛先を入力してください';
    if (mode !== 'reply' && !subject.trim()) return '件名を入力してください';
    if (!selectedMailbox) return '送信元メールアカウントを選択してください';
    if (uploading) return '添付ファイルのアップロード完了をお待ちください';
    if (savedAtts.length > MAX_ATTACHMENTS) return `添付ファイルは${MAX_ATTACHMENTS}件までです`;
    return null;
  }

  function triggerSend() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');

    // A datetime is armed via the schedule modal — the send button confirms
    // the reservation ("予約送信") instead of sending immediately.
    if (scheduledAtInput) {
      const when = new Date(scheduledAtInput);
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        setScheduleError('未来の日時を指定してください');
        setShowSchedulePicker(true);
        return;
      }
      void handleSchedule(when);
      return;
    }

    setShowOverlay(true);
  }

  function buildSendPayload(): SendPayload {
    const editorHtml = editorRef.current?.getHTML() || '';
    const editorText = editorRef.current?.getText() || '';
    const sigSection = signature && sigVisible
      ? `<p>${signature.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`
      : '';
    let html = editorHtml + sigSection;
    if (mode === 'reply' && quote) {
      html += `<p style="color:#6b7280;font-size:12px;margin-top:16px">${quote.header}</p><blockquote style="border-left:3px solid #d1d5db;margin:8px 0;padding:4px 12px;color:#6b7280">${quote.html}</blockquote>`;
    }
    const text = signature && sigVisible ? `${editorText}\n\n${signature}` : editorText;
    return {
      mailboxId: selectedMailbox, to: toChips, cc: ccChips, bcc: bccChips, subject, html, text,
      draftAttachmentIds: savedAtts.map(a => a.id),
    };
  }

  async function executeSend() {
    setShowOverlay(false);
    setSending(true);
    setError('');
    try {
      const payload = buildSendPayload();
      const err = await onSend(payload);
      if (err) { setError(err); return; }
      await draft.deleteDraft();
      // Check for recipients not yet in contacts
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const allEmails = [...new Set([...payload.to, ...payload.cc, ...payload.bcc])].filter(e => EMAIL_RE.test(e));
      const unknown = await findUnknownEmails(allEmails);
      if (unknown.length > 0) {
        setNewContactEmails(unknown);
        // onCancel() will be called after the prompt closes
      } else {
        onCancel();
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSchedule(when: Date) {
    setScheduleError('');
    setScheduling(true);
    try {
      const payload = buildSendPayload();
      const err2 = await onSchedule!(payload, when);
      if (err2) { setError(err2); return; }
      await draft.deleteDraft();
      setShowSchedulePicker(false);
      onCancel();
    } finally {
      setScheduling(false);
    }
  }

  async function handleAI() {
    if (!editorRef.current) return;
    if (mode === 'compose' && editorRef.current.isEmpty() && !subject.trim()) {
      setError('件名か本文を入力してからAIを使用してください');
      return;
    }
    setAiLoading(true);
    setError('');
    try {
      const body = mode === 'reply'
        ? { threadId, draft: editorRef.current.isEmpty() ? '' : editorRef.current.getHTML() }
        : { subject, to: toChips.join(', '), draft: editorRef.current.isEmpty() ? '' : editorRef.current.getHTML() };
      const res = await fetch('/api/ai/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'AI処理に失敗しました'); return; }
      editorRef.current.setHTML(json.text.replace(/\n/g, '<br>'));
      editorRef.current.focus();
    } finally {
      setAiLoading(false);
    }
  }

  const isInline = mode !== 'compose';
  // Whether this render is shown in the fullscreen modal shell — compose is
  // always modal; reply/forward only when toggled fullscreen. All layout
  // sizing (paddings, field row density, editor height) follows this rather
  // than `isInline` so a fullscreen reply looks identical to compose, not
  // like a stretched version of the compact inline card.
  const isModal = !isInline || isFullscreen;
  const bodyHeight = minBodyHeight ?? (isModal ? 360 : mode === 'forward' ? 180 : 200);
  const px = isModal ? 'px-2 sm:px-5' : 'px-4';

  async function handleFieldConflictReload() {
    if (!draft.draftId) return;
    try {
      const res = await fetch(`/api/drafts/${draft.draftId}`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.to_raw) setToChips(d.to_raw.split(/[,;]\s*/).map((s: string) => s.trim()).filter(Boolean));
      if (d.cc_raw !== undefined) {
        const cc = d.cc_raw ? d.cc_raw.split(/[,;]\s*/).map((s: string) => s.trim()).filter(Boolean) : [];
        setCcChips(cc);
        if (cc.length) setShowCc(true);
      }
      if (d.bcc_raw !== undefined) {
        const bcc = d.bcc_raw ? d.bcc_raw.split(/[,;]\s*/).map((s: string) => s.trim()).filter(Boolean) : [];
        setBccChips(bcc);
        if (bcc.length) setShowBcc(true);
      }
      if (d.subject !== undefined) setSubject(d.subject || '');
      if (d.mailbox_id) setSelectedMailbox(d.mailbox_id);
      if (Array.isArray(d.attachments)) setSavedAtts(d.attachments);
      if (d.updated_at) draft.initServerTimestamp(d.updated_at);
      draft.dismissConflict();
    } catch { /* ignore */ }
  }

  const conflictBanner = draft.conflict ? (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
      <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span className="flex-1">
        {draft.conflict.updatedByName ? `${draft.conflict.updatedByName}がフィールドを編集しました` : '他のユーザーがフィールドを編集しました'}
      </span>
      <button type="button" onClick={handleFieldConflictReload} className="font-medium text-amber-700 underline hover:text-amber-900">最新版を読み込む</button>
      <button type="button" onClick={draft.dismissConflict} className="text-amber-400 hover:text-amber-700">✕</button>
    </div>
  ) : null;

  // ── Shared sections ────────────────────────────────────────────────

  const fieldsSection = (
    <div className={`${!isModal ? 'border-b border-gray-100 px-4 py-2 space-y-1 text-xs' : 'px-2 sm:px-5 space-y-0'}`}>
      {/* From */}
      <div className={!isModal ? 'flex items-center gap-2 py-0.5' : 'flex items-center gap-3 border-b border-gray-100 py-2.5'}>
        <span className={`text-gray-400 shrink-0 ${!isModal ? 'w-7' : 'w-12 text-xs font-medium'}`}>From</span>
        {mailboxes.length > 1 ? (
          <select
            value={selectedMailbox}
            onChange={e => {
              const next = e.target.value;
              const nextTeam = mailboxes.find(m => m.id === next)?.type === 'team';
              if (nextTeam !== isTeam) {
                // The editor is rebuilt when collaboration starts or stops: keep what is typed.
                const html = editorRef.current?.getHTML() ?? richContentRef.current;
                carryRef.current = html;
                richContentRef.current = html;
                if (!nextTeam) setEditorBody(html); // plain editor starts from this
              }
              setSelectedMailbox(next);
              // keep the saved draft's sender (and, when leaving a shared draft, its body) in step; only when a draft exists
              if (draft.draftId) {
                const leaving = isTeam && !nextTeam;
                if (leaving) yjsStateRef.current = null; // the plain editor owns the body now
                draft.scheduleSave({
                  ...draftPayload(), mailbox_id: next, is_shared: nextTeam,
                  ...(leaving ? { html_body: richContentRef.current, text_body: editorRef.current?.getText() } : {}),
                });
              }
            }}
            className={!isModal ? 'flex-1 bg-transparent border-0 outline-hidden text-gray-700 cursor-pointer text-xs' : 'select flex-1 text-sm py-1'}
          >
            {mailboxes.map(mb => <option key={mb.id} value={mb.id}>{mb.display_name} &lt;{mb.email_address}&gt;</option>)}
          </select>
        ) : (
          <span className="text-gray-500 truncate flex-1 text-xs">{selectedMb?.email_address || ''}</span>
        )}
      </div>

      {/* To */}
      <div className={!isModal ? 'flex items-start gap-2 py-0.5' : 'flex items-start gap-3 border-b border-gray-100 py-2'}>
        <span className={`text-gray-400 shrink-0 pt-0.5 ${!isModal ? 'w-7' : 'w-12 text-xs font-medium'}`}>To</span>
        <div className="flex-1 min-w-0">
          <EmailChipInput
            chips={toChips}
            onChange={chips => { setToChips(chips); saveDraft({ to: chips }); }}
            placeholder="宛先アドレス（Enter・Tab・カンマで確定）"
          />
        </div>
        {(!showCc || !showBcc) && (
          <div className="flex gap-1">
            {!showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className={!isModal
                  ? 'shrink-0 px-1.5 py-0.5 rounded-sm text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors'
                  : 'text-xs text-blue-600 hover:underline shrink-0 pt-2'}
              >
                CC
              </button>
            )}
            {!showBcc && (
              <button
                type="button"
                onClick={() => setShowBcc(true)}
                className={!isModal
                  ? 'shrink-0 px-1.5 py-0.5 rounded-sm text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors'
                  : 'text-xs text-blue-600 hover:underline shrink-0 pt-2'}
              >
                BCC
              </button>
            )}
          </div>
        )}
      </div>

      {/* CC */}
      {showCc && (
        <div className={!isModal ? 'flex items-start gap-2 py-0.5' : 'flex items-start gap-3 border-b border-gray-100 py-2'}>
          <span className={`text-gray-400 shrink-0 pt-0.5 ${!isModal ? 'w-7' : 'w-12 text-xs font-medium'}`}>CC</span>
          <div className="flex-1 min-w-0">
            <EmailChipInput
              chips={ccChips}
              onChange={chips => { setCcChips(chips); saveDraft({ cc: chips }); }}
              placeholder="CCアドレス（Enter・Tab・カンマで確定）"
            />
          </div>
          <button
            type="button"
            onClick={() => { setShowCc(false); setCcChips([]); }}
            className={!isModal
              ? 'shrink-0 px-1.5 py-0.5 rounded-sm text-xs text-blue-600 bg-blue-50 transition-colors'
              : 'text-xs text-gray-400 hover:text-gray-600 shrink-0 pt-2'}
          >
            {!isModal ? 'CC' : '×'}
          </button>
        </div>
      )}

      {/* BCC */}
      {showBcc && (
        <div className={!isModal ? 'flex items-start gap-2 py-0.5' : 'flex items-start gap-3 border-b border-gray-100 py-2'}>
          <span className={`text-gray-400 shrink-0 pt-0.5 ${!isModal ? 'w-7' : 'w-12 text-xs font-medium'}`}>BCC</span>
          <div className="flex-1 min-w-0">
            <EmailChipInput
              chips={bccChips}
              onChange={chips => { setBccChips(chips); saveDraft({ bcc: chips }); }}
              placeholder="BCCアドレス（Enter・Tab・カンマで確定）"
            />
          </div>
          <button
            type="button"
            onClick={() => { setShowBcc(false); setBccChips([]); }}
            className={!isModal
              ? 'shrink-0 px-1.5 py-0.5 rounded-sm text-xs text-blue-600 bg-blue-50 transition-colors'
              : 'text-xs text-gray-400 hover:text-gray-600 shrink-0 pt-2'}
          >
            {!isModal ? 'BCC' : '×'}
          </button>
        </div>
      )}

      {/* Subject (compose + forward) */}
      {mode !== 'reply' && (
        <div className={!isModal ? 'flex items-center gap-2 py-0.5' : 'flex items-center gap-3 border-b border-gray-100 py-2.5'}>
          <span className={`text-gray-400 shrink-0 ${!isModal ? 'w-7' : 'w-12 text-xs font-medium'}`}>件名</span>
          <input
            type="text"
            className="flex-1 text-sm text-gray-900 focus:outline-hidden placeholder-gray-400 bg-transparent"
            placeholder="件名を入力"
            value={subject}
            onChange={e => { setSubject(e.target.value); saveDraft({ subject: e.target.value }); }}
          />
        </div>
      )}
    </div>
  );

  const presenceAvatars = (ydoc && collaborators.length > 0) ? (
    <div className="flex -space-x-2 shrink-0">
      {collaborators.map(c => (
        <div
          key={c.clientId}
          title={`${c.name} が編集中`}
          className="relative w-6 h-6 rounded-full border-2 overflow-hidden ring-1 ring-white"
          style={{ borderColor: c.color }}
        >
          {/* initial fallback sits underneath; avatar image overlays it (hides on error) */}
          <span
            className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white"
            style={{ backgroundColor: c.color }}
          >
            {c.name.charAt(0)}
          </span>
          {c.id && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/users/${c.id}/avatar`}
              alt={c.name}
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </div>
      ))}
    </div>
  ) : null;

  const editorSection = (
    <div className={isModal ? 'pt-3 pb-2 px-2 sm:px-5' : 'p-3'}>
      {editorReady ? <RichEditor
        ref={editorRef}
        placeholder={mode === 'reply' ? '返信内容を入力してください…' : '本文を入力してください…'}
        minHeight={bodyHeight}
        initialHTML={editorBody}
        onInput={() => {
          richContentRef.current = editorRef.current?.getHTML() || richContentRef.current;
          saveDraft();
        }}
        ydoc={ydoc ?? undefined}
        awareness={awareness ?? undefined}
        seedHTML={collabSeed ?? undefined}
        onSeeded={() => { carryRef.current = null; legacySeedRef.current = null; }}
        currentUser={currentUser}
        onCollaboratorsChange={setCollaborators}
      /> : (
        // until it is known which editor this is (plain or shared) and what it starts with: typing into an editor that is about to be replaced would be lost
        <div className="border border-gray-200 rounded-lg bg-gray-50/60" style={{ minHeight: bodyHeight + 42 }} aria-busy="true" />
      )}
    </div>
  );

  const hasSigOptions = isTeam && replyUsers.length > 0;
  const signatureSection = (signature || hasSigOptions) ? (
    <div className={`border-t border-dashed border-gray-200 pt-2 pb-2 ${px} mx-0`}>
      <div className="flex items-start justify-between gap-2">
        {sigVisible && signature
          ? <p className="text-sm text-gray-900 whitespace-pre-wrap flex-1">{'\n'}{signature}</p>
          : <span className="flex-1 text-xs text-gray-300 self-center">署名なし</span>}
        <div className="relative shrink-0" ref={sigPickerRef}>
          <button
            type="button"
            onClick={() => {
              if (hasSigOptions) {
                setShowSigPicker(v => !v);
              } else {
                syncSignature(null, !sigVisible);
              }
            }}
            title="署名を選択"
            className={`p-1 rounded-sm transition-colors ${(sigVisible && signature) ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300 hover:text-gray-500'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          {showSigPicker && (
            <div className="absolute right-0 bottom-full mb-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
              {replyUsers.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { syncSignature(u.signature, true); setShowSigPicker(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${selectedSigUser?.id === u.id && sigVisible ? 'text-blue-700 font-medium' : 'text-gray-700'}`}
                >
                  {selectedSigUser?.id === u.id && sigVisible && (
                    <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  )}
                  <span className={selectedSigUser?.id === u.id && sigVisible ? '' : 'ml-5'}>{u.name}</span>
                </button>
              ))}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => { syncSignature(null, false); setShowSigPicker(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${!sigVisible ? 'text-blue-700 font-medium' : 'text-gray-500'}`}
                >
                  {!sigVisible && (
                    <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  )}
                  <span className={!sigVisible ? '' : 'ml-5'}>署名なし</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const quoteSection = mode === 'reply' && quote ? (
    <div className="px-3 pb-2">
      <button
        type="button"
        onClick={() => setShowQuote(v => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
      >
        <span className="tracking-widest leading-none">···</span>
        {showQuote ? '引用を閉じる' : '前のメールを表示'}
      </button>
      {showQuote && (
        <div className="mt-2 border-l-2 border-gray-200 pl-3">
          <p className="text-xs text-gray-400 mb-1">{quote.header}</p>
          <div className="prose prose-sm max-w-none text-gray-500 overflow-x-auto text-xs" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(quote.html) }} />
        </div>
      )}
    </div>
  ) : null;

  const attachmentsSection = (savedAtts.length > 0 || uploading || attachError) ? (
    <div className={`pb-2 ${px}`}>
      {(savedAtts.length > 0 || uploading) && (
        <div className="flex flex-wrap gap-2 mb-1">
          {savedAtts.map(a => (
            <span key={a.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-700">
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              <a
                href={`/api/drafts/${draft.draftId}/attachments/${a.id}`}
                onClick={e => e.stopPropagation()}
                className="hover:underline"
              >
                {a.filename}
              </a>
              <button type="button" onClick={() => void removeAttachment(a.id)} className="text-gray-400 hover:text-red-500 ml-0.5">×</button>
            </span>
          ))}
          {uploading && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-dashed border-gray-300 text-xs text-gray-500">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
              アップロード中…
            </span>
          )}
        </div>
      )}
      {attachError && <p className="text-xs text-red-600">{attachError}</p>}
    </div>
  ) : null;

  const syncStatus = (
    <DraftStatusBar status={draft.status} savedAt={draft.savedAt} />
  );

  const aiBtn = (
    <button
      type="button"
      onClick={handleAI}
      disabled={aiLoading}
      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {aiLoading
        ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
        : <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>}
      {aiLoading ? '生成中…' : 'AI'}
    </button>
  );

  const cancelBtn = (
    <button
      onClick={onCancel}
      className={`inline-flex items-center justify-center rounded-lg text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-colors ${!isModal ? 'p-1.5 md:px-3 md:py-1.5' : 'p-1.5 sm:px-3 sm:py-1.5'}`}
    >
      <svg className={`w-4 h-4 ${!isModal ? 'md:hidden' : 'sm:hidden'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
      <span className={!isModal ? 'hidden md:inline' : 'hidden sm:inline'}>キャンセル</span>
    </button>
  );

  const sendBtn = (
    <button onClick={triggerSend} disabled={sending || scheduling} className="btn btn-primary btn-sm gap-1">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
      {scheduling ? '予約中…' : sending ? '送信中…' : scheduledAtInput ? '予約送信' : mode === 'forward' ? '転送する' : '送信'}
    </button>
  );

  const scheduleBtn = onSchedule ? (
    <button
      type="button"
      onClick={() => setShowSchedulePicker(true)}
      title="送信日時を指定"
      className={`inline-flex items-center justify-center p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        scheduledAtInput ? 'text-blue-700 bg-blue-50 border-blue-200' : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-100'
      }`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
  ) : null;

  const scheduleModal = (showSchedulePicker && onSchedule) ? (
    <ScheduleSendModal
      initialValue={scheduledAtInput}
      initialError={scheduleError}
      onConfirm={(v) => { setScheduledAtInput(v); setScheduleError(''); setShowSchedulePicker(false); }}
      onClear={scheduledAtInput ? () => { setScheduledAtInput(''); setScheduleError(''); setShowSchedulePicker(false); } : undefined}
      onClose={() => setShowSchedulePicker(false)}
    />
  ) : null;

  const dragOverlay = isDragging && (
    <div className="absolute inset-0 z-50 bg-blue-50/90 border-2 border-dashed border-blue-400 rounded-xl flex items-center justify-center pointer-events-none">
      <p className="text-blue-600 font-semibold text-sm">ファイルをドロップして添付</p>
    </div>
  );

  const fileInput = (
    <label className={`cursor-pointer flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-200 transition-colors ${isModal ? 'border border-gray-200 bg-white' : ''}`} title="ファイル添付">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
      <span className={!isModal ? 'hidden md:inline' : 'hidden sm:inline'}>ファイル添付</span>
      <input type="file" multiple className="sr-only" onChange={e => {
        if (!e.target.files) return;
        void addFiles(Array.from(e.target.files));
        e.target.value = '';
      }} />
    </label>
  );

  const overlay = showOverlay && (
    <SendingOverlay onConfirm={executeSend} onCancel={() => setShowOverlay(false)} />
  );

  const newContactsPrompt = newContactEmails.length > 0 && (
    <NewContactsPrompt
      emails={newContactEmails}
      onDone={() => { setNewContactEmails([]); onCancel(); }}
    />
  );

  // ── Shared chrome: one modal shell (backdrop + centered card + header +
  // scrollable body + footer) is used both for compose (always modal) and
  // for reply/forward when expanded to fullscreen — instead of maintaining
  // two near-duplicate layouts. Only the inline reply/forward card (the
  // default, non-fullscreen reply/forward view) has its own lighter chrome.
  const accent = mode === 'reply' ? 'border-blue-200' : mode === 'forward' ? 'border-green-200' : 'border-gray-200';
  const modalTitle = mode === 'compose' ? (draftId ? '下書きを編集' : '新規メール作成') : mode === 'reply' ? '返信を作成' : '転送';
  const modalSub = mode === 'reply' ? (toChips[0] || '') : mode === 'forward' ? `Fw: ${subject}` : '';
  const modalIcon = mode === 'reply' ? (
    <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  ) : mode === 'forward' ? (
    <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) : null;

  // reply/forward's inline card (light header, colored icon) uses its own
  // theme-matching icon color instead of the modal shell's dark-bg variant.
  const inlineIcon = mode === 'reply' ? (
    <svg className="w-4 h-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );

  // How to leave the modal shell differs by mode: compose has no "home" to
  // return to, so it minimizes to a floating bar; reply/forward's home is
  // the inline card, so it just un-fullscreens.
  function requestCollapse() {
    if (!isInline) setMinimized(true);
    else setIsFullscreen(false);
  }

  const minimizeBtn = !isInline ? (
    <button onClick={() => setMinimized(true)} className="p-1.5 rounded-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors" title="最小化">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
    </button>
  ) : null;

  const fullscreenToggleBtn = isInline ? (
    <button
      type="button"
      onClick={() => setIsFullscreen(v => !v)}
      title={isFullscreen ? '元のサイズに戻す' : 'フルスクリーンで開く'}
      className={isFullscreen
        ? 'p-1.5 rounded-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors'
        : 'text-gray-400 hover:text-gray-600 p-1 rounded-sm hover:bg-gray-200 transition-colors'}
    >
      {isFullscreen ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15v4.5M15 15H4.5m10.5 0l5.25 5.25M9 15H4.5M9 15v4.5M9 15l-5.25 5.25" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75h4.5m-4.5 0v4.5m0-4.5L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9M3.75 20.25h4.5m-4.5 0v-4.5m0 4.5L9 15M20.25 20.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
      )}
    </button>
  ) : null;

  const modalHeaderBar = (
    <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-gray-200 shrink-0 bg-gray-800 sm:rounded-t-2xl">
      <div className="flex items-center gap-2 min-w-0">
        {modalIcon}
        <h2 className="font-semibold text-white text-sm shrink-0">{modalTitle}</h2>
        {modalSub && <span className="text-gray-400 text-xs truncate">→ {modalSub}</span>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {presenceAvatars}
        {minimizeBtn}
        {fullscreenToggleBtn}
        <button onClick={onCancel} className="p-1.5 rounded-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors" title="閉じる">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );

  const inlineHeaderBar = (
    <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200 shrink-0">
      <div className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
        {inlineIcon}
        <span className="font-medium shrink-0">{modalTitle}</span>
        {modalSub && <span className="text-gray-400 text-xs truncate">→ {modalSub}</span>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {presenceAvatars}
        {fullscreenToggleBtn}
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-1 rounded-sm hover:bg-gray-200 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );

  const bodyContent = (
    <>
      {conflictBanner}
      {fieldsSection}
      {editorSection}
      {signatureSection}
      {quoteSection}
      {attachmentsSection}
    </>
  );

  const footerBar = (
    <div className="bg-gray-50 border-t border-gray-200 shrink-0" style={isModal ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}>
      <div className="flex items-center justify-between px-3 pt-2 pb-0 md:hidden">
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          外部に送信されます
        </p>
        {syncStatus}
      </div>
      <div className="flex items-center justify-between px-3 py-2 md:px-4 md:py-2.5">
        <div className="flex items-center gap-1.5">
          {fileInput}
          <p className="hidden md:flex text-xs text-amber-600 items-center gap-1">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            外部に送信されます
          </p>
          <span className="hidden md:block">{syncStatus}</span>
        </div>
        <div className="flex items-center gap-1.5">{aiBtn}{scheduleBtn}{cancelBtn}{sendBtn}</div>
      </div>
    </div>
  );

  const errorBanner = error && (
    <div className="px-3 pb-2 shrink-0">
      <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
    </div>
  );

  if (isModal) {
    if (minimized) {
      return (
        <div className="fixed bottom-0 right-6 z-110 w-80 shadow-2xl rounded-t-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 text-white cursor-pointer hover:bg-gray-700 transition-colors" onClick={() => setMinimized(false)}>
            <span className="text-sm font-medium truncate">{modalTitle}</span>
            <div className="flex items-center gap-1.5 ml-2 shrink-0" onClick={e => e.stopPropagation()}>
              <button onClick={() => setMinimized(false)} className="p-1 rounded-sm hover:bg-gray-600 transition-colors" title="展開">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
              </button>
              <button onClick={onCancel} className="p-1 rounded-sm hover:bg-gray-600 transition-colors" title="閉じる">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-110 flex flex-col sm:items-center sm:justify-center sm:p-4">
        <div className="absolute inset-0 bg-black/30 backdrop-blur-xs" onClick={requestCollapse} />
        {newContactsPrompt}
        {overlay}
        {scheduleModal}
        <div
          className={`relative w-full h-full sm:h-auto sm:max-w-5xl sm:max-h-[94vh] bg-white sm:rounded-2xl sm:shadow-2xl border ${accent} flex flex-col overflow-hidden`}
          {...dragHandlers}
        >
          {dragOverlay}
          {modalHeaderBar}
          <div className="flex-1 overflow-y-auto">
            <div className="pt-3 pb-2">
              {bodyContent}
              {errorBanner}
            </div>
          </div>
          {footerBar}
        </div>
      </div>
    );
  }

  // ── Inline reply/forward card (default, non-fullscreen) ──────────────
  return (
    <div className={`relative card overflow-hidden shadow-lg ${accent}`} {...dragHandlers}>
      {dragOverlay}
      {newContactsPrompt}
      {overlay}
      {scheduleModal}
      {inlineHeaderBar}
      {bodyContent}
      {footerBar}
      {errorBanner}
    </div>
  );
}

async function findUnknownEmails(emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  try {
    const res = await fetch(`/api/contacts?emails=${encodeURIComponent(emails.join(','))}`);
    const data = await res.json();
    const known = new Set((data.contacts || []).map((c: { email?: string }) => c.email?.toLowerCase()));
    return emails.filter(e => !known.has(e.toLowerCase()));
  } catch {
    return [];
  }
}

function NewContactsPrompt({ emails, onDone }: { emails: string[]; onDone: () => void }) {
  const [names, setNames] = useState<Record<string, string>>(
    () => Object.fromEntries(emails.map(e => [e, '']))
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      const toSave = emails.filter(e => names[e]?.trim());
      await Promise.all(
        toSave.map(email =>
          fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: names[email].trim(), email }),
          })
        )
      );
    } finally {
      setSaving(false);
      onDone();
    }
  }

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-1">連絡先に追加</h3>
        <p className="text-xs text-gray-500 mb-4">
          未登録のアドレスに名前を入力してください。空欄はスキップします。
        </p>
        <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
          {emails.map((email, i) => (
            <div key={email}>
              <p className="text-xs text-gray-400 truncate mb-1">{email}</p>
              <input
                type="text"
                placeholder="名前（例: 田中 太郎）"
                value={names[email]}
                onChange={e => setNames(prev => ({ ...prev, [email]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                className="input w-full text-sm"
                autoFocus={i === 0}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onDone}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            スキップ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="btn btn-primary btn-sm"
          >
            {saving ? '保存中…' : '登録する'}
          </button>
        </div>
      </div>
    </div>
  );
}
