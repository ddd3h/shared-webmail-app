'use client';
import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { RichEditorHandle } from '@/components/RichEditor';
import type { CollabEditorHandle } from '@/components/CollabEditor';
import { useDraft } from '@/hooks/useDraft';
import { useCollab } from '@/hooks/useCollab';
import DraftStatusBar from '@/components/DraftStatus';
import EmailChipInput from '@/components/EmailChipInput';

const RichEditor = dynamic(() => import('@/components/RichEditor'), { ssr: false });
const CollabEditor = dynamic(() => import('@/components/CollabEditor'), { ssr: false });

type Mailbox = { id: string; display_name: string; email_address: string; type: string; user_permissions?: { can_reply: boolean } };
type ContactSuggestion = { name: string | null; email: string };

// Recipient input with contact autocomplete
function RecipientInput({ value, onChange, placeholder, onScheduleSave }: {
  value: string; onChange: (v: string) => void; placeholder?: string; onScheduleSave?: (v: string) => void
}) {
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    onChange(v);
    onScheduleSave?.(v);
    const token = v.split(/[,;]/).pop()?.trim() || '';
    if (token.length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/contacts?q=${encodeURIComponent(token)}`);
      const data = await res.json();
      const contacts: ContactSuggestion[] = (data.contacts || []).filter((c: any) => c.email).slice(0, 8);
      setSuggestions(contacts);
      setShowSuggestions(contacts.length > 0);
    }, 200);
  }

  function select(c: ContactSuggestion) {
    const parts = value.split(/[,;]/);
    parts[parts.length - 1] = c.email;
    const v = parts.map(p => p.trim()).filter(Boolean).join(', ') + ', ';
    onChange(v);
    setSuggestions([]);
    setShowSuggestions(false);
    onScheduleSave?.(v);
  }

  return (
    <div className="relative flex-1">
      <input
        type="text"
        className="w-full text-sm text-gray-900 focus:outline-none placeholder-gray-400 bg-transparent"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
        autoComplete="off"
      />
      {showSuggestions && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map((c, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(c); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2.5 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">
                {(c.name?.[0] || c.email[0]).toUpperCase()}
              </div>
              <div className="min-w-0">
                {c.name && <div className="font-medium text-gray-900 truncate">{c.name}</div>}
                <div className="text-gray-500 truncate text-xs">{c.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeModal({ onClose, onSent, initialDraftId }: { onClose: () => void; onSent: () => void; initialDraftId?: string }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState('');
  const [toChips, setToChips] = useState<string[]>([]);
  const [ccChips, setCcChips] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [initialBody, setInitialBody] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [composeSig, setComposeSig] = useState('');
  const [composeSigVisible, setComposeSigVisible] = useState(true);
  const editorRef = useRef<RichEditorHandle | CollabEditorHandle>(null);
  const richContentRef = useRef('');
  const draft = useDraft(initialDraftId);
  const isTeam = mailboxes.find(m => m.id === selectedMailbox)?.type === 'team';
  const collabSessionId = isTeam && draft.draftId ? `draft-${draft.draftId}` : undefined;
  const collab = useCollab(collabSessionId);

  // Accept override values to avoid stale-closure issue when called inside onChange handlers
  const scheduleFieldSave = (overrides: { subject?: string; to_raw?: string; cc_raw?: string; toChips?: string[]; ccChips?: string[] } = {}) => {
    const mb = mailboxes.find(m => m.id === selectedMailbox);
    const isShared = mb?.type === 'team';
    const inCollabMode = !!(isTeam && collab.doc);
    draft.scheduleSave({
      mailbox_id: selectedMailbox || undefined,
      to_raw: overrides.to_raw ?? (overrides.toChips ?? toChips).join(', '),
      cc_raw: overrides.cc_raw ?? ((overrides.ccChips ?? ccChips).join(', ') || undefined),
      subject: overrides.subject ?? subject,
      // Yjs manages body in collab mode; avoid overwriting with stale editor state
      ...(!inCollabMode && {
        html_body: editorRef.current?.getHTML(),
        text_body: editorRef.current?.getText(),
      }),
      is_shared: isShared,
    });
  };

  useEffect(() => {
    fetch('/api/mailboxes?mine=1').then(r => r.json()).then(d => {
      const items = (d.items || []).filter((m: Mailbox) => m.user_permissions?.can_reply !== false);
      setMailboxes(items);
      if (!initialDraftId && items.length > 0) setSelectedMailbox(items[0].id);
    });
    // Load signature for new compose (not draft)
    if (!initialDraftId) {
      fetch('/api/user/signature').then(r => r.json()).then(d => {
        const sig = d.signature ?? (d.name ? `${d.name}${d.email ? '\n' + d.email : ''}` : '');
        if (sig) setComposeSig(sig);
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!initialDraftId) return;
    fetch(`/api/drafts/${initialDraftId}`).then(r => r.json()).then(d => {
      if (d.id) {
        setToChips(d.to_raw ? d.to_raw.split(/[,;]\s*/).map((s: string) => s.trim()).filter(Boolean) : []);
        const loadedCc = d.cc_raw ? d.cc_raw.split(/[,;]\s*/).map((s: string) => s.trim()).filter(Boolean) : [];
        setCcChips(loadedCc); if (loadedCc.length > 0) setShowCc(true);
        setSubject(d.subject || '');
        if (d.mailbox_id) setSelectedMailbox(d.mailbox_id);
        if (d.html_body) { setInitialBody(d.html_body); richContentRef.current = d.html_body; }
      }
    }).catch(() => {});
  }, [initialDraftId]);

  async function handleAiAssist() {
    if (!editorRef.current) return;
    if (editorRef.current.isEmpty() && !subject.trim()) {
      setError('件名か本文を入力してからAIを使用してください');
      return;
    }
    setAiLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          to: toChips.join(', '),
          draft: editorRef.current.isEmpty() ? '' : editorRef.current.getHTML(),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'AI処理に失敗しました'); return; }
      editorRef.current.setHTML(json.text.replace(/\n/g, '<br>'));
      editorRef.current.focus();
    } finally {
      setAiLoading(false);
    }
  }

  async function send() {
    if (!toChips.length) { setError('宛先を入力してください'); return; }
    if (!subject.trim()) { setError('件名を入力してください'); return; }
    if (!selectedMailbox) { setError('送信元メールアカウントを選択してください'); return; }

    setSending(true);
    setError('');
    try {
      const editorHtml = editorRef.current?.getHTML() || '';
      const editorText = editorRef.current?.getText() || '';
      const sigSuffix = composeSig && composeSigVisible
        ? `<p>--<br>${composeSig.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`
        : '';
      const html = editorHtml + sigSuffix;
      const text = composeSig && composeSigVisible ? `${editorText}\n\n-- \n${composeSig}` : editorText;
      const fd = new FormData();
      fd.append('mailbox_id', selectedMailbox);
      fd.append('to', JSON.stringify(toChips));
      if (ccChips.length) fd.append('cc', JSON.stringify(ccChips));
      fd.append('subject', subject);
      fd.append('html', html);
      fd.append('text', text);
      attachments.forEach(f => fd.append('file', f));
      const res = await fetch('/api/messages/compose', { method: 'POST', body: fd });
      if (res.ok) { await draft.deleteDraft(); onSent(); onClose(); }
      else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || '送信に失敗しました');
      }
    } finally {
      setSending(false);
    }
  }

  // ── Minimized pill ───────────────────────────────────────────────
  if (minimized) {
    return (
      <div className="fixed bottom-0 right-6 z-50 w-80 shadow-2xl rounded-t-xl overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-2.5 bg-gray-800 text-white cursor-pointer hover:bg-gray-700 transition-colors"
          onClick={() => setMinimized(false)}
        >
          <span className="text-sm font-medium truncate">{subject || '新規メール作成'}</span>
          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={() => setMinimized(false)} className="p-1 rounded hover:bg-gray-600 transition-colors" title="展開">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/></svg>
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-600 transition-colors" title="閉じる">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Full modal ───────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center sm:p-4">
      {/* Backdrop (デスクトップのみ有効) */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMinimized(true)} />

      {/* Modal — モバイルは全画面、デスクトップはカード */}
      <div className="relative w-full h-full sm:h-auto sm:max-w-5xl bg-white sm:rounded-2xl sm:shadow-2xl flex flex-col sm:max-h-[94vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0 bg-gray-800 sm:rounded-t-2xl">
          <h2 className="font-semibold text-white text-sm">新規メール作成</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setMinimized(true)} className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors" title="最小化">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4"/></svg>
            </button>
            <button onClick={onClose} className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors" title="閉じる">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 pt-3 space-y-0">
            {/* From */}
            <div className="flex items-center gap-3 border-b border-gray-100 py-2.5">
              <span className="text-xs font-medium text-gray-400 w-12 flex-shrink-0">From</span>
              <select value={selectedMailbox} onChange={e => setSelectedMailbox(e.target.value)} className="select flex-1 text-sm py-1">
                {mailboxes.map(m => <option key={m.id} value={m.id}>{m.display_name} &lt;{m.email_address}&gt;</option>)}
              </select>
            </div>

            {/* To */}
            <div className="flex items-start gap-3 border-b border-gray-100 py-2">
              <span className="text-xs font-medium text-gray-400 w-12 flex-shrink-0 pt-2">To</span>
              <div className="flex-1 min-w-0">
                <EmailChipInput
                  chips={toChips}
                  onChange={chips => { setToChips(chips); scheduleFieldSave({ toChips: chips }); }}
                  placeholder="宛先アドレス（Enter・Tab・カンマで確定）"
                />
              </div>
              {!showCc && (
                <button type="button" onClick={() => setShowCc(true)} className="text-xs text-blue-600 hover:underline flex-shrink-0 pt-2">Cc追加</button>
              )}
            </div>

            {/* CC */}
            {showCc && (
              <div className="flex items-start gap-3 border-b border-gray-100 py-2">
                <span className="text-xs font-medium text-gray-400 w-12 flex-shrink-0 pt-2">Cc</span>
                <div className="flex-1 min-w-0">
                  <EmailChipInput
                    chips={ccChips}
                    onChange={chips => { setCcChips(chips); scheduleFieldSave({ ccChips: chips }); }}
                    placeholder="CC（Enter・Tab・カンマで確定）"
                  />
                </div>
                <button type="button" onClick={() => { setShowCc(false); setCcChips([]); }} className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0 pt-2">×</button>
              </div>
            )}

            {/* Subject */}
            <div className="flex items-center gap-3 border-b border-gray-100 py-2.5">
              <span className="text-xs font-medium text-gray-400 w-12 flex-shrink-0">件名</span>
              <input
                type="text"
                className="flex-1 text-sm text-gray-900 focus:outline-none placeholder-gray-400 bg-transparent"
                placeholder="件名を入力"
                value={subject}
                onChange={e => { setSubject(e.target.value); scheduleFieldSave({ subject: e.target.value }); }}
              />
            </div>

            {/* Body */}
            <div className="pt-3 pb-2">
              {isTeam && collab.doc && collab.awareness && collab.me ? (
                <CollabEditor
                  ref={editorRef as React.Ref<CollabEditorHandle>}
                  doc={collab.doc}
                  awareness={collab.awareness}
                  me={collab.me}
                  activeUsers={collab.activeUsers}
                  placeholder="本文を入力してください…"
                  minHeight={360}
                  initialHTML={richContentRef.current || undefined}
                />
              ) : (
                <RichEditor
                  ref={editorRef as React.Ref<RichEditorHandle>}
                  placeholder="本文を入力してください…"
                  minHeight={360}
                  initialHTML={initialBody}
                  onInput={() => {
                    richContentRef.current = editorRef.current?.getHTML() || richContentRef.current;
                    scheduleFieldSave();
                  }}
                />
              )}
            </div>

            {/* Signature */}
            {composeSig && (
              <div className="mx-0 border-t border-dashed border-gray-200 mt-1 pt-2 pb-2">
                <div className="flex items-start justify-between gap-2">
                  {composeSigVisible ? (
                    <p className="text-sm text-gray-900 whitespace-pre-wrap flex-1">{'--\n'}{composeSig}</p>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <button
                    type="button"
                    onClick={() => setComposeSigVisible(v => !v)}
                    title={composeSigVisible ? '署名を外す' : '署名を追加'}
                    className={`flex-shrink-0 p-1 rounded transition-colors ${composeSigVisible ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300 hover:text-gray-500'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* Attachments list */}
            {attachments.length > 0 && (
              <div className="pb-3 flex flex-wrap gap-2">
                {attachments.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-700">
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                    {f.name}
                    <button type="button" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-0.5">×</button>
                  </span>
                ))}
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 flex-shrink-0 bg-gray-50 sm:rounded-b-2xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {/* Mobile info row: sync status */}
          <div className="flex items-center justify-end px-4 pt-2 pb-0 sm:hidden">
            {isTeam && collabSessionId ? (
              <span className={`text-xs flex items-center gap-1 ${collab.connected ? 'text-emerald-600' : 'text-gray-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${collab.connected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                {collab.connected ? '同期中' : '接続中…'}
              </span>
            ) : (
              <DraftStatusBar status={draft.status} savedAt={draft.savedAt} />
            )}
          </div>

          {/* Actions row */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              {/* Attach — icon only on mobile */}
              <label className="cursor-pointer flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-200 transition-colors border border-gray-200 bg-white" title="ファイル添付">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                <span className="hidden sm:inline">ファイル添付</span>
                <input type="file" multiple className="sr-only" onChange={e => { if (e.target.files) setAttachments(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
              </label>
              {/* Desktop only: sync status */}
              {isTeam && collabSessionId ? (
                <span className={`hidden sm:flex text-xs items-center gap-1 ${collab.connected ? 'text-emerald-600' : 'text-gray-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${collab.connected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                  {collab.connected ? '同期中' : '接続中…'}
                </span>
              ) : (
                <span className="hidden sm:block">
                  <DraftStatusBar status={draft.status} savedAt={draft.savedAt} />
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {/* AI */}
              <button
                type="button"
                onClick={handleAiAssist}
                disabled={aiLoading}
                title={editorRef.current?.isEmpty() ? 'AIで本文を生成' : 'AIで校正・改善'}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {aiLoading ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                  </svg>
                )}
                {aiLoading ? '生成中…' : 'AI'}
              </button>
              {/* Cancel — × icon on mobile, text on desktop */}
              <button
                onClick={onClose}
                title="キャンセル"
                className="inline-flex items-center justify-center p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="hidden sm:inline">キャンセル</span>
              </button>
              {/* Send */}
              <button onClick={send} disabled={sending} className="btn btn-primary btn-sm gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                {sending ? '送信中…' : '送信する'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type ThreadReader = { id: string; name: string; mattermost_user_id: string | null };

type Thread = {
  id: string;
  subject: string;
  status: string;
  unread_count: number;
  last: string;
  mailbox: string;
  mailbox_type: string;
  mailbox_id: string;
  assigned: string | null;
  last_replied_by: string | null;
  from_email: string | null;
  from_name: string | null;
  has_mattermost: boolean;
  readers: ThreadReader[];
};

const MAILBOX_COLOR_PALETTE = [
  'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
];

function mailboxColorIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) >>> 0;
  return h % MAILBOX_COLOR_PALETTE.length;
}

function mailboxDot(mailboxId: string, name: string) {
  const cls = MAILBOX_COLOR_PALETTE[mailboxColorIndex(mailboxId)];
  return (
    <span title={name} className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />
  );
}

const STATUS_LABELS: Record<string, string> = {
  open: '未対応',
  in_progress: '対応中',
  waiting: '対応中',  // treat legacy 'waiting' same as in_progress
  done: '完了',
  archived: 'アーカイブ'
};

const STATUS_CHIP: Record<string, string> = {
  open: 'bg-rose-50 text-rose-700 ring-rose-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  waiting: 'bg-blue-50 text-blue-700 ring-blue-200',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  archived: 'bg-gray-100 text-gray-400 ring-gray-200'
};

function formatDate(d: string) {
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60 * 60 * 1000) {
    const m = Math.floor(diff / 60000);
    return m <= 0 ? 'たった今' : `${m}分前`;
  }
  if (diff < 24 * 60 * 60 * 1000) return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (diff < 7 * 24 * 60 * 60 * 1000) return date.toLocaleDateString('ja-JP', { weekday: 'short' });
  if (now.getFullYear() === date.getFullYear()) return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
}

const PERSONAL_TABS = [
  { id: '', label: 'すべて' },
  { id: 'unread', label: '未読' },
  { id: 'sent', label: '送信済み' },
  { id: 'drafts', label: '下書き' },
] as const;

const TEAM_TABS = [
  { id: '', label: 'すべて' },
  { id: 'unread', label: '未読' },
  { id: 'mine', label: '自分の担当' },
  { id: 'open', label: '未対応' },
  { id: 'in_progress', label: '対応中' },
  { id: 'sent', label: '送信済み' },
  { id: 'drafts', label: '下書き' },
] as const;

type DraftItem = {
  id: string;
  to_raw: string | null;
  subject: string | null;
  is_shared: boolean;
  updated_at: string;
  mailbox: { display_name: string; type: string } | null;
  user: { name: string };
};

function ThreadList() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mailboxView, setMailboxView] = useState<'personal' | 'team'>('personal');
  const [tab, setTab] = useState('unread');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterAfter, setFilterAfter] = useState('');
  const [filterBefore, setFilterBefore] = useState('');
  const [filterAttachment, setFilterAttachment] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [personalUnread, setPersonalUnread] = useState(0);
  const [teamUnread, setTeamUnread] = useState(0);
  const [nextCursor, setNextCursor] = useState<{ last: string; id: string } | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<{ last: string; id: string }>>([]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);

  const selectionMode = selected.size > 0;
  const currentTabs = mailboxView === 'personal' ? PERSONAL_TABS : TEAM_TABS;

  function toggleSelect(id: string, index: number) {
    lastSelectedIndexRef.current = index;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function rangeSelect(toIndex: number) {
    const from = lastSelectedIndexRef.current;
    if (from === null) return false;
    const start = Math.min(from, toIndex);
    const end = Math.max(from, toIndex);
    const rangeIds = threads.slice(start, end + 1).map(t => t.id);
    setSelected(prev => {
      const next = new Set(prev);
      rangeIds.forEach(id => next.add(id));
      return next;
    });
    lastSelectedIndexRef.current = toIndex;
    return true;
  }

  function selectAll() {
    if (selected.size === threads.length && threads.length > 0) {
      setSelected(new Set());
      lastSelectedIndexRef.current = null;
    } else {
      setSelected(new Set(threads.map(t => t.id)));
    }
  }

  async function bulkMarkRead() {
    setBulkLoading(true);
    await Promise.all([...selected].map(id =>
      fetch(`/api/threads/${id}/read`, { method: 'POST' })
    ));
    setSelected(new Set());
    setBulkLoading(false);
    load(mailboxView, tab, search);
  }

  async function bulkSetStatus(status: string) {
    setBulkLoading(true);
    await Promise.all([...selected].map(id =>
      fetch(`/api/threads/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      })
    ));
    setSelected(new Set());
    setBulkLoading(false);
    load(mailboxView, tab, search);
  }

  async function bulkDelete() {
    setBulkLoading(true);
    await Promise.all([...selected].map(id =>
      fetch(`/api/threads/${id}/delete`, { method: 'POST' })
    ));
    setSelected(new Set());
    setConfirmDelete(false);
    setBulkLoading(false);
    load(mailboxView, tab, search);
  }

  async function bulkDeleteDrafts() {
    if (!confirm(`${selected.size} 件の下書きを削除しますか？`)) return;
    setBulkLoading(true);
    await Promise.all([...selected].map(id =>
      fetch(`/api/drafts/${id}`, { method: 'DELETE' })
    ));
    setSelected(new Set());
    setBulkLoading(false);
    load(mailboxView, 'drafts', '');
  }

  const load = useCallback(async (
    view: 'personal' | 'team',
    activeTab: string,
    q: string,
    cursor?: { last: string; id: string },
  ) => {
    setLoading(true);
    // Only show the spinner if loading takes longer than 200 ms
    if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
    spinnerTimerRef.current = setTimeout(() => setShowSpinner(true), 200);

    if (activeTab === 'drafts') {
      const res = await fetch('/api/drafts');
      const data = await res.json();
      setDrafts(data.drafts || []);
      setNextCursor(null);
    } else {
      const params = new URLSearchParams();
      params.set('type', view);
      if (activeTab === 'unread') params.set('unread', '1');
      else if (activeTab === 'mine') params.set('mine', '1');
      else if (activeTab === 'sent') params.set('sent', '1');
      else if (activeTab) params.set('status', activeTab);
      if (q) params.set('q', q);
      if (cursor) { params.set('cursor', cursor.last); params.set('cursor_id', cursor.id); }
      const res = await fetch(`/api/threads?${params}`);
      const data = await res.json();
      setThreads(data.items || []);
      setNextCursor(data.nextCursor || null);
    }

    if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
    setLoading(false);
    setShowSpinner(false);
  }, []);

  // Restore scroll position when coming back
  useEffect(() => {
    const savedScroll = sessionStorage.getItem('threads-scroll');
    if (savedScroll && listRef.current) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedScroll));
        sessionStorage.removeItem('threads-scroll');
      });
    }
  }, [threads]);

  useEffect(() => {
    const savedView = (sessionStorage.getItem('threads-view') as 'personal' | 'team') || 'personal';
    const savedTab = sessionStorage.getItem('threads-tab');
    sessionStorage.removeItem('threads-tab');
    const t = savedTab ?? searchParams.get('tab') ?? 'unread';
    setMailboxView(savedView);
    setTab(t);
    load(savedView, t, '');
    // Load unread counts for segment badges (dedicated lightweight endpoint)
    fetch('/api/threads/unread-counts')
      .then(r => r.json())
      .then(d => { setPersonalUnread(d.personal || 0); setTeamUnread(d.team || 0); })
      .catch(() => {});
  }, []);

  function resetFilters() {
    setSearchInput('');
    setFilterFrom('');
    setFilterAfter('');
    setFilterBefore('');
    setFilterAttachment(false);
    setShowFilters(false);
    setSearch('');
  }

  function switchView(view: 'personal' | 'team') {
    setMailboxView(view);
    setTab('unread');
    setNextCursor(null);
    setCursorStack([]);
    resetFilters();
    setSelected(new Set());
    setConfirmDelete(false);
    lastSelectedIndexRef.current = null;
    sessionStorage.setItem('threads-view', view);
    load(view, 'unread', '');
  }

  function switchTab(newTab: string) {
    setTab(newTab);
    setNextCursor(null);
    setCursorStack([]);
    resetFilters();
    setSelected(new Set());
    setConfirmDelete(false);
    lastSelectedIndexRef.current = null;
    load(mailboxView, newTab, '');
  }

  function buildQuery(text: string, from: string, after: string, before: string, attachment: boolean) {
    const parts: string[] = [];
    if (text.trim()) parts.push(text.trim());
    if (from.trim()) parts.push(`from:${from.trim()}`);
    if (after) parts.push(`after:${after}`);
    if (before) parts.push(`before:${before}`);
    if (attachment) parts.push('has:attachment');
    return parts.join(' ');
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = buildQuery(searchInput, filterFrom, filterAfter, filterBefore, filterAttachment);
    setSearch(q);
    setTab('');
    setNextCursor(null);
    setCursorStack([]);
    load(mailboxView, '', q);
  }

  function clearSearch() {
    setSearchInput('');
    setFilterFrom('');
    setFilterAfter('');
    setFilterBefore('');
    setFilterAttachment(false);
    setShowFilters(false);
    setSearch('');
    setNextCursor(null);
    setCursorStack([]);
    load(mailboxView, tab, '');
  }

  function handleRowClick(e: React.MouseEvent, id: string, index: number) {
    if (selectionMode) {
      if (e.shiftKey && rangeSelect(index)) return;
      toggleSelect(id, index);
      return;
    }
    sessionStorage.setItem('threads-scroll', String(window.scrollY));
    sessionStorage.setItem('threads-tab', tab);
    router.push(`/threads/${id}`);
  }

  function handleCheckboxClick(e: React.MouseEvent, id: string, index: number) {
    e.stopPropagation();
    if (e.shiftKey && lastSelectedIndexRef.current !== null) {
      rangeSelect(index);
    } else {
      toggleSelect(id, index);
    }
  }


  return (
    <div className="space-y-0">
      {showCompose && (
        <ComposeModal
          onClose={() => { setShowCompose(false); setOpenDraftId(undefined); }}
          onSent={() => { load(mailboxView, tab, search); }}
          initialDraftId={openDraftId}
        />
      )}

      {/* Header */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">メール</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCompose(true)}
              className="btn btn-primary btn-sm gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              新規メール
            </button>
            <button
              onClick={() => load(mailboxView, tab, search)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="更新"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="search"
                placeholder="件名・本文・送信者を検索…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                showFilters || filterFrom || filterAfter || filterBefore || filterAttachment
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              title="詳細フィルター"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="hidden sm:inline">フィルター</span>
            </button>
            <button type="submit" className="btn btn-secondary btn-sm px-2.5 sm:px-3">
              <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="hidden sm:inline">検索</span>
            </button>
            {search && (
              <button type="button" onClick={clearSearch} className="btn btn-secondary btn-sm px-2.5 sm:px-3 text-gray-500">
                <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="hidden sm:inline">クリア</span>
              </button>
            )}
          </div>

          {/* Advanced filters */}
          {showFilters && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">送信者</label>
                  <input
                    type="text"
                    placeholder="名前またはアドレス"
                    value={filterFrom}
                    onChange={e => setFilterFrom(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">期間（開始）</label>
                  <input
                    type="date"
                    value={filterAfter}
                    onChange={e => setFilterAfter(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">期間（終了）</label>
                  <input
                    type="date"
                    value={filterBefore}
                    onChange={e => setFilterBefore(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterAttachment}
                  onChange={e => setFilterAttachment(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 border-gray-300"
                />
                添付ファイルあり
              </label>
            </div>
          )}

          {/* Active filter chips */}
          {search && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-gray-400">検索中:</span>
              {searchInput && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  {searchInput}
                </span>
              )}
              {filterFrom && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-medium">
                  送信者: {filterFrom}
                </span>
              )}
              {filterAfter && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                  {filterAfter} 以降
                </span>
              )}
              {filterBefore && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                  {filterBefore} 以前
                </span>
              )}
              {filterAttachment && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                  添付あり
                </span>
              )}
            </div>
          )}
        </form>
      </div>

      {/* Segment switcher */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 mb-4">
        {/* 個人メール */}
        <button
          onClick={() => switchView('personal')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-4 rounded-lg text-sm font-semibold transition-all ${
            mailboxView === 'personal'
              ? 'bg-white shadow-sm text-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          個人メール
          {personalUnread > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-bold">
              {personalUnread}
            </span>
          )}
        </button>
        {/* 共有メール */}
        <button
          onClick={() => switchView('team')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-4 rounded-lg text-sm font-semibold transition-all ${
            mailboxView === 'team'
              ? 'bg-white shadow-sm text-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          共有メール
          {teamUnread > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-violet-600 text-white text-xs font-bold">
              {teamUnread}
            </span>
          )}
        </button>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 mb-0">
        <nav className="flex overflow-x-auto">
          {currentTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Bulk action bar */}
      {selectionMode && tab === 'drafts' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-x border-gray-200">
          <input
            type="checkbox"
            checked={selected.size === drafts.length && drafts.length > 0}
            ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < drafts.length; }}
            onChange={() => {
              if (selected.size === drafts.length && drafts.length > 0) {
                setSelected(new Set());
              } else {
                setSelected(new Set(drafts.map(d => d.id)));
              }
            }}
            className="w-4 h-4 rounded text-amber-600 border-gray-300 cursor-pointer"
          />
          <span className="text-sm font-medium text-amber-700">{selected.size} 件選択中</span>
          <div className="flex-1" />
          <button onClick={bulkDeleteDrafts} disabled={bulkLoading} className="btn btn-sm px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 ring-1 ring-inset ring-red-200">
            {bulkLoading ? '削除中…' : '削除'}
          </button>
          <button onClick={() => { setSelected(new Set()); }} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">解除</button>
        </div>
      )}
      {selectionMode && tab !== 'drafts' && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 border-x border-blue-600">
          <input
            type="checkbox"
            checked={selected.size === threads.length && threads.length > 0}
            ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < threads.length; }}
            onChange={selectAll}
            className="w-4 h-4 rounded border-white/50 cursor-pointer accent-white"
          />
          <span className="text-sm font-semibold text-white">{selected.size} 件選択</span>
          <div className="flex-1" />

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/90 font-medium hidden sm:inline">
                {mailboxView === 'team' ? '全ユーザーから削除されます。' : `${selected.size} 件を削除します。`}元に戻せません。
              </span>
              <button
                onClick={bulkDelete}
                disabled={bulkLoading}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {bulkLoading ? '削除中…' : '削除する'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={bulkLoading}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-400 border border-white/30 transition-colors"
              >
                キャンセル
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={bulkMarkRead}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/15 text-white hover:bg-white/25 border border-white/20 transition-colors disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="hidden sm:inline">既読</span>
              </button>
              {mailboxView === 'team' && (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { bulkSetStatus(e.target.value); e.target.value = ''; } }}
                  disabled={bulkLoading}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium bg-white/15 text-white border border-white/20 cursor-pointer disabled:opacity-50 focus:outline-none"
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="" className="text-gray-900 bg-white">ステータス変更…</option>
                  <option value="open" className="text-gray-900 bg-white">未対応</option>
                  <option value="in_progress" className="text-gray-900 bg-white">対応中</option>
                  <option value="done" className="text-gray-900 bg-white">完了</option>
                </select>
              )}
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/80 text-white hover:bg-red-500 border border-red-400/50 transition-colors disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span className="hidden sm:inline">削除</span>
              </button>
            </div>
          )}

          <button
            onClick={() => { setSelected(new Set()); setConfirmDelete(false); lastSelectedIndexRef.current = null; }}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition-colors ml-1"
            title="選択解除"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Thread / Draft rows */}
      <div ref={listRef} className="bg-white rounded-b-xl border-x border-b border-gray-200 overflow-hidden shadow-sm">
        {showSpinner ? (
          <div className="py-16 text-center">
            <div className="inline-block w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400 mt-2">読み込み中…</p>
          </div>
        ) : tab === 'drafts' ? (
          drafts.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-4xl mb-3">📝</div>
              <p className="text-gray-400 text-sm">下書きはありません</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {drafts.map((d) => {
                const isDraftSelected = selected.has(d.id);
                return (
                <div
                  key={d.id}
                  onClick={() => {
                    if (selectionMode) { toggleSelect(d.id, drafts.indexOf(d)); return; }
                    setOpenDraftId(d.id); setShowCompose(true);
                  }}
                  className={`group cursor-pointer transition-colors select-none ${isDraftSelected ? 'bg-amber-50' : 'hover:bg-amber-50/40'}`}
                >
                  {/* ── モバイルレイアウト (< sm) ── */}
                  <div className="flex items-start gap-3 px-4 py-3 sm:hidden">
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleSelect(d.id, drafts.indexOf(d)); }}
                      className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all mt-0.5 ${
                        isDraftSelected ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                      }`}
                    >
                      {isDraftSelected ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="flex-1 min-w-0 truncate text-sm text-gray-600">
                          {d.to_raw ? `To: ${d.to_raw.split(/[,;\s]+/)[0]}` : '(宛先なし)'}
                        </span>
                        <span className="flex-shrink-0 text-xs tabular-nums text-gray-400">{formatDate(d.updated_at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="flex-1 min-w-0 truncate text-sm text-amber-700 font-medium">
                          {d.subject || '(件名なし)'}
                        </span>
                        {d.is_shared && (
                          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">共有</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── PCレイアウト (sm+) — 変更前のレイアウト ── */}
                  <div className="hidden sm:flex items-center gap-3 px-4 py-3">
                    <div className="flex-shrink-0 w-5 flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isDraftSelected}
                        onChange={() => {}}
                        onClick={(e) => { e.stopPropagation(); toggleSelect(d.id, drafts.indexOf(d)); }}
                        className={`w-4 h-4 rounded text-amber-600 border-gray-300 cursor-pointer transition-opacity ${selectionMode || isDraftSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      />
                    </div>
                    <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-amber-100 text-amber-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </div>
                    <div className="flex-shrink-0 w-32 truncate text-sm text-gray-600">
                      {d.to_raw ? `To: ${d.to_raw.split(/[,;\s]+/)[0]}` : '(宛先なし)'}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="truncate text-sm text-amber-700 font-medium">{d.subject || '(件名なし)'}</span>
                      {d.is_shared && (
                        <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">共有下書き</span>
                      )}
                      {d.mailbox && d.mailbox.type === 'team' && (
                        <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">チーム</span>
                      )}
                    </div>
                    {d.is_shared && (
                      <div className="flex-shrink-0 hidden lg:block w-20 truncate text-xs text-gray-400 text-right">{d.user.name}</div>
                    )}
                    <div className="flex-shrink-0 hidden md:block">
                      {d.mailbox && <span className="text-xs text-gray-400">{d.mailbox.display_name}</span>}
                    </div>
                    {!selectionMode && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm('この下書きを削除しますか？')) return;
                          await fetch(`/api/drafts/${d.id}`, { method: 'DELETE' });
                          load(mailboxView, 'drafts', '');
                        }}
                        className="flex-shrink-0 p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        title="削除"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                    <div className="flex-shrink-0 text-xs tabular-nums w-14 text-right text-gray-400">{formatDate(d.updated_at)}</div>
                  </div>
                </div>
                );
              })}
            </div>
          )
        ) : threads.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">✉</div>
            <p className="text-gray-400 text-sm">メールはありません</p>
            {search && (
              <button onClick={clearSearch} className="mt-3 text-sm text-blue-600 hover:underline">
                検索をクリア
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {threads.map((t, index) => {
              const isUnread = t.unread_count > 0;
              const isSelected = selected.has(t.id);
              return (
                <div
                  key={t.id}
                  onClick={(e) => handleRowClick(e, t.id, index)}
                  className={`group cursor-pointer transition-colors select-none ${
                    isSelected ? 'bg-blue-50' : isUnread ? 'bg-white hover:bg-blue-50/50' : 'hover:bg-gray-50'
                  }`}
                >
                  {/* ── モバイルレイアウト (< sm) ── */}
                  <div className="flex items-start gap-3 px-4 py-3 sm:hidden">
                    {/* アバタータップで選択 */}
                    <div className="relative flex-shrink-0 mt-0.5">
                      <div
                        onClick={(e) => handleCheckboxClick(e, t.id, index)}
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                          isSelected ? 'bg-blue-600 text-white'
                          : isUnread ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {isSelected ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          (t.from_email?.[0] || '?').toUpperCase()
                        )}
                      </div>
                      {isUnread && !isSelected && (
                        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
                      )}
                    </div>
                    {/* 3行コンテンツ */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`flex-1 min-w-0 truncate text-sm ${isUnread ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
                          {t.from_name || t.from_email?.split('@')[0] || '(不明)'}
                        </span>
                        {t.mailbox_type === 'team' && (
                          <span className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${STATUS_CHIP[t.status] || 'bg-gray-50 text-gray-500 ring-gray-200'}`}>
                            {STATUS_LABELS[t.status] || t.status}
                          </span>
                        )}
                        <span className={`flex-shrink-0 text-xs tabular-nums ${isUnread ? 'font-semibold text-gray-700' : 'text-gray-400'}`}>
                          {formatDate(t.last)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {t.mailbox_type === 'team' && mailboxDot(t.mailbox_id, t.mailbox)}
                        <span className={`flex-1 min-w-0 truncate text-sm ${isUnread ? 'font-medium text-gray-800' : 'text-gray-500'}`}>
                          {t.subject || '(件名なし)'}
                        </span>
                        {t.has_mattermost && (
                          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">M</span>
                        )}
                      </div>
                      {t.mailbox_type === 'team' && t.readers.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="text-[11px] text-gray-400 flex-shrink-0">既読</span>
                          <div className="flex items-center -space-x-1">
                            {t.readers.slice(0, 8).map(r => (
                              <div key={r.id} title={r.name} className="w-5 h-5 rounded-full border-2 border-white overflow-hidden bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-500 flex-shrink-0">
                                {r.mattermost_user_id ? (
                                  <img src={`/api/users/${r.id}/avatar`} alt={r.name} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.textContent = r.name[0]?.toUpperCase() || '?'; }} />
                                ) : r.name[0]?.toUpperCase() || '?'}
                              </div>
                            ))}
                            {t.readers.length > 8 && (
                              <div className="w-5 h-5 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-400 flex-shrink-0">+{t.readers.length - 8}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── PCレイアウト (sm+) — 変更前のレイアウト ── */}
                  <div className="hidden sm:flex items-center gap-3 px-4 py-3">
                    {/* 未読ドット / チェックボックス */}
                    <div className="flex-shrink-0 w-5 flex items-center justify-center relative">
                      {isUnread && !selectionMode && (
                        <div className="w-2 h-2 rounded-full bg-blue-500 group-hover:opacity-0 transition-opacity" />
                      )}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => handleCheckboxClick(e, t.id, index)}
                        className={`absolute w-4 h-4 rounded text-blue-600 border-gray-300 cursor-pointer transition-opacity ${
                          selectionMode || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      />
                    </div>
                    {/* アバター */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      isUnread ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {(t.from_email?.[0] || '?').toUpperCase()}
                    </div>
                    {/* From */}
                    <div className={`flex-shrink-0 w-32 truncate text-sm ${isUnread ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
                      {t.from_name || t.from_email?.split('@')[0] || '(不明)'}
                    </div>
                    {/* 件名 */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {t.mailbox_type === 'team' && mailboxDot(t.mailbox_id, t.mailbox)}
                      <span className={`truncate text-sm ${isUnread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                        {t.subject || '(件名なし)'}
                      </span>
                      {t.has_mattermost && (
                        <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">M</span>
                      )}
                    </div>
                    {/* チームメール: 担当 + ステータス + 既読 */}
                    {t.mailbox_type === 'team' && (
                      <>
                        <div className="flex-shrink-0 hidden md:flex items-center gap-1.5 min-w-0 max-w-[120px]">
                          {t.assigned ? (
                            <span className="truncate text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 max-w-full">
                              {t.assigned}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">未担当</span>
                          )}
                        </div>
                        <div className="flex-shrink-0 hidden md:block">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${STATUS_CHIP[t.status] || 'bg-gray-50 text-gray-500 ring-gray-200'}`}>
                            {STATUS_LABELS[t.status] || t.status}
                          </span>
                        </div>
                        {t.readers.length > 0 && (
                          <div className="flex-shrink-0 hidden lg:flex items-center -space-x-1.5">
                            {t.readers.slice(0, 5).map(r => (
                              <div key={r.id} title={r.name} className="w-5 h-5 rounded-full border border-white overflow-hidden bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-500">
                                {r.mattermost_user_id ? (
                                  <img src={`/api/users/${r.id}/avatar`} alt={r.name} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.textContent = r.name[0]?.toUpperCase() || '?'; }} />
                                ) : r.name[0]?.toUpperCase() || '?'}
                              </div>
                            ))}
                            {t.readers.length > 5 && (
                              <div className="w-5 h-5 rounded-full border border-white bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-400">+{t.readers.length - 5}</div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {/* 日付 */}
                    <div className={`flex-shrink-0 text-xs tabular-nums w-14 text-right ${isUnread ? 'font-semibold text-gray-700' : 'text-gray-400'}`}>
                      {formatDate(t.last)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!showSpinner && tab === 'drafts' && drafts.length > 0 && (
        <p className="text-xs text-gray-400 text-right pt-2">{drafts.length} 件</p>
      )}
      {!showSpinner && tab !== 'drafts' && threads.length > 0 && (
        <div className="pt-2 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {(() => {
              const start = cursorStack.length * 50 + 1;
              const end = cursorStack.length * 50 + threads.length;
              return search ? `${start}〜${end} 件ヒット` : `${start}〜${end} 件`;
            })()}
          </p>
          <div className="flex items-center gap-2">
            {cursorStack.length > 0 && (
              <button
                onClick={() => {
                  const newStack = cursorStack.slice(0, -1);
                  setCursorStack(newStack);
                  setNextCursor(null);
                  load(mailboxView, tab, search, newStack[newStack.length - 1]);
                }}
                disabled={loading}
                className="btn btn-secondary btn-sm text-xs disabled:opacity-50 gap-1"
              >
                ← 前へ
              </button>
            )}
            {nextCursor && (
              <button
                onClick={() => {
                  setCursorStack(prev => [...prev, nextCursor!]);
                  load(mailboxView, tab, search, nextCursor!);
                }}
                disabled={loading}
                className="btn btn-secondary btn-sm text-xs disabled:opacity-50 gap-1"
              >
                次へ →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ThreadsPage() {
  return (
    <Suspense fallback={
      <div className="py-16 text-center text-sm text-gray-400">読み込み中…</div>
    }>
      <ThreadList />
    </Suspense>
  );
}
