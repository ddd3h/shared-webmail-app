'use client';
import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { RichEditorHandle } from './RichEditor';
import type { CollabEditorHandle } from './CollabEditor';
import { useDraft } from '@/hooks/useDraft';
import { useCollab } from '@/hooks/useCollab';
import DraftStatusBar from './DraftStatus';
import EmailChipInput from './EmailChipInput';
import SendingOverlay from './SendingOverlay';

const RichEditor = dynamic(() => import('./RichEditor'), { ssr: false });
const CollabEditor = dynamic(() => import('./CollabEditor'), { ssr: false });

export type ComposeMode = 'compose' | 'reply' | 'forward';

export type SendPayload = {
  mailboxId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  files: File[];
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
  onCancel: () => void;
  minBodyHeight?: number;
}

type Mailbox = { id: string; display_name: string; email_address: string; type: string };

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
  onCancel,
  minBodyHeight,
}: ComposeFormProps) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState(defaultMailboxId || '');
  const [toChips, setToChips] = useState<string[]>(initialTo);
  const [ccChips, setCcChips] = useState<string[]>(initialCc);
  const [bccChips, setBccChips] = useState<string[]>(initialBcc);
  const [showCc, setShowCc] = useState(initialCc.length > 0);
  const [showBcc, setShowBcc] = useState(initialBcc.length > 0);
  const [subject, setSubject] = useState(initialSubject);
  const [files, setFiles] = useState<File[]>([]);
  const [attachError, setAttachError] = useState('');
  const [sigVisible, setSigVisible] = useState(true);
  const [signature, setSignature] = useState('');
  const [showQuote, setShowQuote] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [editorBody, setEditorBody] = useState(initialBody);
  const [newContactEmails, setNewContactEmails] = useState<string[]>([]);

  const editorRef = useRef<RichEditorHandle | CollabEditorHandle>(null);
  const richContentRef = useRef(initialBody);

  const draft = useDraft(draftId);

  const selectedMb = mailboxes.find(m => m.id === selectedMailbox);
  const isTeam = selectedMb?.type === 'team';

  const collabSessionId =
    mode === 'reply' ? (isTeam ? threadId : undefined) :
    mode === 'compose' && isTeam && draft.draftId ? `draft-${draft.draftId}` :
    undefined;
  const collab = useCollab(collabSessionId);
  const inCollab = !!(collab.doc && collab.awareness && collab.me);

  // When collab activates mid-debounce, strip body from pending save to avoid overwriting collab state
  useEffect(() => {
    if (inCollab) draft.stripBodyFromPending();
  }, [inCollab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch mailboxes and signature on mount
  useEffect(() => {
    fetch('/api/mailboxes?mine=1')
      .then(r => r.json())
      .then(d => {
        const items: Mailbox[] = (d.items || []).filter((m: any) => m.user_permissions?.can_reply !== false);
        setMailboxes(items);
        setSelectedMailbox(prev => prev || defaultMailboxId || items[0]?.id || '');
      })
      .catch(() => {});
    fetch('/api/user/signature')
      .then(r => r.json())
      .then(d => {
        const sig = d.signature ?? (d.name ? `${d.name}${d.email ? '\n' + d.email : ''}` : '');
        if (sig) setSignature(sig);
      })
      .catch(() => {});
  }, []);

  // Load draft data when draftId provided
  useEffect(() => {
    if (!draftId) return;
    fetch(`/api/drafts/${draftId}`)
      .then(r => r.json())
      .then(d => {
        if (!d.id) return;
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
        if (d.html_body) { setEditorBody(d.html_body); richContentRef.current = d.html_body; }
      })
      .catch(() => {});
  }, [draftId]);

  function saveDraft(overrides: { to?: string[]; cc?: string[]; bcc?: string[]; subject?: string } = {}) {
    const resolvedTo = overrides.to ?? toChips;
    const resolvedCc = overrides.cc ?? ccChips;
    const resolvedBcc = overrides.bcc ?? bccChips;
    const resolvedSubject = overrides.subject ?? subject;
    draft.scheduleSave({
      mailbox_id: selectedMailbox || undefined,
      thread_id: mode === 'reply' ? threadId : undefined,
      to_raw: resolvedTo.join(', '),
      cc_raw: resolvedCc.join(', ') || undefined,
      bcc_raw: resolvedBcc.join(', ') || undefined,
      subject: resolvedSubject,
      ...(!inCollab && {
        html_body: editorRef.current?.getHTML(),
        text_body: editorRef.current?.getText(),
      }),
      is_shared: isTeam,
    });
  }

  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
  const MAX_FILES = 10;

  function validate() {
    if (!toChips.length) return '宛先を入力してください';
    if (mode !== 'reply' && !subject.trim()) return '件名を入力してください';
    if (!selectedMailbox) return '送信元メールアカウントを選択してください';
    if (files.length > MAX_FILES) return `添付ファイルは${MAX_FILES}件までです`;
    if (files.some(f => f.size > MAX_FILE_BYTES)) return '1ファイルあたり10MB以内にしてください';
    return null;
  }

  function triggerSend() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setShowOverlay(true);
  }

  async function executeSend() {
    setShowOverlay(false);
    setSending(true);
    setError('');
    try {
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
      const err = await onSend({ mailboxId: selectedMailbox, to: toChips, cc: ccChips, bcc: bccChips, subject, html, text, files });
      if (err) { setError(err); return; }
      await draft.deleteDraft();
      // Check for recipients not yet in contacts
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const allEmails = [...new Set([...toChips, ...ccChips, ...bccChips])].filter(e => EMAIL_RE.test(e));
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

  const bodyHeight = minBodyHeight ?? (mode === 'compose' ? 360 : mode === 'forward' ? 180 : 200);
  const isInline = mode !== 'compose';
  const px = isInline ? 'px-4' : 'px-5';

  // ── Shared sections ────────────────────────────────────────────────

  const fieldsSection = (
    <div className={`${isInline ? 'border-b border-gray-100 px-4 py-2 space-y-1 text-xs' : 'px-5 space-y-0'}`}>
      {/* From */}
      <div className={isInline ? 'flex items-center gap-2 py-0.5' : 'flex items-center gap-3 border-b border-gray-100 py-2.5'}>
        <span className={`text-gray-400 flex-shrink-0 ${isInline ? 'w-7' : 'w-12 text-xs font-medium'}`}>From</span>
        {mailboxes.length > 1 ? (
          <select
            value={selectedMailbox}
            onChange={e => setSelectedMailbox(e.target.value)}
            className={isInline ? 'flex-1 bg-transparent border-0 outline-none text-gray-700 cursor-pointer text-xs' : 'select flex-1 text-sm py-1'}
          >
            {mailboxes.map(mb => <option key={mb.id} value={mb.id}>{mb.display_name} &lt;{mb.email_address}&gt;</option>)}
          </select>
        ) : (
          <span className="text-gray-500 truncate flex-1 text-xs">{selectedMb?.email_address || ''}</span>
        )}
      </div>

      {/* To */}
      <div className={isInline ? 'flex items-start gap-2 py-0.5' : 'flex items-start gap-3 border-b border-gray-100 py-2'}>
        <span className={`text-gray-400 flex-shrink-0 pt-0.5 ${isInline ? 'w-7' : 'w-12 text-xs font-medium'}`}>To</span>
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
                className={isInline
                  ? 'flex-shrink-0 px-1.5 py-0.5 rounded text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors'
                  : 'text-xs text-blue-600 hover:underline flex-shrink-0 pt-2'}
              >
                CC
              </button>
            )}
            {!showBcc && (
              <button
                type="button"
                onClick={() => setShowBcc(true)}
                className={isInline
                  ? 'flex-shrink-0 px-1.5 py-0.5 rounded text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors'
                  : 'text-xs text-blue-600 hover:underline flex-shrink-0 pt-2'}
              >
                BCC
              </button>
            )}
          </div>
        )}
      </div>

      {/* CC */}
      {showCc && (
        <div className={isInline ? 'flex items-start gap-2 py-0.5' : 'flex items-start gap-3 border-b border-gray-100 py-2'}>
          <span className={`text-gray-400 flex-shrink-0 pt-0.5 ${isInline ? 'w-7' : 'w-12 text-xs font-medium'}`}>CC</span>
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
            className={isInline
              ? 'flex-shrink-0 px-1.5 py-0.5 rounded text-xs text-blue-600 bg-blue-50 transition-colors'
              : 'text-xs text-gray-400 hover:text-gray-600 flex-shrink-0 pt-2'}
          >
            {isInline ? 'CC' : '×'}
          </button>
        </div>
      )}

      {/* BCC */}
      {showBcc && (
        <div className={isInline ? 'flex items-start gap-2 py-0.5' : 'flex items-start gap-3 border-b border-gray-100 py-2'}>
          <span className={`text-gray-400 flex-shrink-0 pt-0.5 ${isInline ? 'w-7' : 'w-12 text-xs font-medium'}`}>BCC</span>
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
            className={isInline
              ? 'flex-shrink-0 px-1.5 py-0.5 rounded text-xs text-blue-600 bg-blue-50 transition-colors'
              : 'text-xs text-gray-400 hover:text-gray-600 flex-shrink-0 pt-2'}
          >
            {isInline ? 'BCC' : '×'}
          </button>
        </div>
      )}

      {/* Subject (compose + forward) */}
      {mode !== 'reply' && (
        <div className={isInline ? 'flex items-center gap-2 py-0.5' : 'flex items-center gap-3 border-b border-gray-100 py-2.5'}>
          <span className={`text-gray-400 flex-shrink-0 ${isInline ? 'w-7' : 'w-12 text-xs font-medium'}`}>件名</span>
          <input
            type="text"
            className="flex-1 text-sm text-gray-900 focus:outline-none placeholder-gray-400 bg-transparent"
            placeholder="件名を入力"
            value={subject}
            onChange={e => { setSubject(e.target.value); saveDraft({ subject: e.target.value }); }}
          />
        </div>
      )}
    </div>
  );

  const editorSection = (
    <div className={mode === 'compose' ? 'pt-3 pb-2 px-5' : 'p-3'}>
      {inCollab ? (
        <CollabEditor
          ref={editorRef as React.Ref<CollabEditorHandle>}
          doc={collab.doc!}
          awareness={collab.awareness!}
          me={collab.me!}
          activeUsers={collab.activeUsers}
          placeholder={mode === 'reply' ? '返信内容を入力してください…' : '本文を入力してください…'}
          minHeight={bodyHeight}
          onLocalUpdate={() => { if (inCollab) saveDraft(); }}
          {...(richContentRef.current ? { initialHTML: richContentRef.current } : {})}
        />
      ) : (
        <RichEditor
          ref={editorRef as React.Ref<RichEditorHandle>}
          placeholder={mode === 'reply' ? '返信内容を入力してください…' : '本文を入力してください…'}
          minHeight={bodyHeight}
          initialHTML={editorBody}
          onInput={() => {
            richContentRef.current = editorRef.current?.getHTML() || richContentRef.current;
            saveDraft();
          }}
        />
      )}
    </div>
  );

  const signatureSection = signature ? (
    <div className={`border-t border-dashed border-gray-200 pt-2 pb-2 ${px} mx-0`}>
      <div className="flex items-start justify-between gap-2">
        {sigVisible
          ? <p className="text-sm text-gray-900 whitespace-pre-wrap flex-1">{'\n'}{signature}</p>
          : <span className="flex-1" />}
        <button
          type="button"
          onClick={() => setSigVisible(v => !v)}
          title={sigVisible ? '署名を外す' : '署名を追加'}
          className={`flex-shrink-0 p-1 rounded transition-colors ${sigVisible ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300 hover:text-gray-500'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
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
          <div className="prose prose-sm max-w-none text-gray-500 overflow-x-auto text-xs" dangerouslySetInnerHTML={{ __html: quote.html }} />
        </div>
      )}
    </div>
  ) : null;

  const attachmentsSection = (files.length > 0 || attachError) ? (
    <div className={`pb-2 ${px}`}>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-1">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-700">
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              {f.name}
              <button type="button" onClick={() => { setFiles(prev => prev.filter((_, j) => j !== i)); setAttachError(''); }} className="text-gray-400 hover:text-red-500 ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
      {attachError && <p className="text-xs text-red-600">{attachError}</p>}
    </div>
  ) : null;

  const syncStatus = (
    <>
      {inCollab && (
        <span className={`text-xs flex items-center gap-1 ${collab.connected ? 'text-emerald-600' : 'text-gray-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${collab.connected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
          {collab.connected ? '同期中' : '接続中…'}
        </span>
      )}
      <DraftStatusBar status={draft.status} savedAt={draft.savedAt} />
    </>
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
      className={`inline-flex items-center justify-center rounded-lg text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-colors ${isInline ? 'p-1.5 md:px-3 md:py-1.5' : 'p-1.5 sm:px-3 sm:py-1.5'}`}
    >
      <svg className={`w-4 h-4 ${isInline ? 'md:hidden' : 'sm:hidden'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
      <span className={isInline ? 'hidden md:inline' : 'hidden sm:inline'}>キャンセル</span>
    </button>
  );

  const sendBtn = (
    <button onClick={triggerSend} disabled={sending} className="btn btn-primary btn-sm gap-1">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
      {sending ? '送信中…' : mode === 'forward' ? '転送する' : '送信する'}
    </button>
  );

  const fileInput = (
    <label className={`cursor-pointer flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-200 transition-colors ${!isInline ? 'border border-gray-200 bg-white' : ''}`} title="ファイル添付">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
      <span className={isInline ? 'hidden md:inline' : 'hidden sm:inline'}>ファイル添付</span>
      <input type="file" multiple className="sr-only" onChange={e => {
        if (!e.target.files) return;
        const added = Array.from(e.target.files);
        const oversized = added.filter(f => f.size > MAX_FILE_BYTES);
        if (oversized.length > 0) {
          setAttachError(`「${oversized[0].name}」は10MBを超えています`);
          e.target.value = '';
          return;
        }
        if (files.length + added.length > MAX_FILES) {
          setAttachError(`添付ファイルは${MAX_FILES}件までです`);
          e.target.value = '';
          return;
        }
        setAttachError('');
        setFiles(prev => [...prev, ...added]);
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

  // ── COMPOSE mode: renders fields+footer for use inside modal ────────
  if (!isInline) {
    return (
      <>
        {newContactsPrompt}
        {overlay}
        <div className="flex-1 overflow-y-auto">
          <div className="pt-3 pb-2">
            {fieldsSection}
            {editorSection}
            {signatureSection}
            {attachmentsSection}
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3 mx-5">{error}</p>}
          </div>
        </div>
        <div className="border-t border-gray-200 flex-shrink-0 bg-gray-50 sm:rounded-b-2xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex items-center justify-end px-4 pt-2 pb-0 sm:hidden">
            {syncStatus}
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              {fileInput}
              <span className="hidden sm:block">{syncStatus}</span>
            </div>
            <div className="flex items-center gap-1.5">{aiBtn}{cancelBtn}{sendBtn}</div>
          </div>
        </div>
      </>
    );
  }

  // ── REPLY / FORWARD mode: self-contained card ────────────────────
  const accent = mode === 'reply' ? 'border-blue-200' : 'border-green-200';
  const headerIcon = mode === 'reply' ? (
    <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
  const headerTitle = mode === 'reply' ? '返信を作成' : '転送';
  const headerSub = mode === 'reply' ? (toChips[0] || '') : `Fw: ${subject}`;

  return (
    <div className={`card overflow-hidden shadow-lg ${accent}`}>
      {newContactsPrompt}
      {overlay}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
          {headerIcon}
          <span className="font-medium flex-shrink-0">{headerTitle}</span>
          {headerSub && <span className="text-gray-400 text-xs truncate">→ {headerSub}</span>}
        </div>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-200 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {fieldsSection}
      {editorSection}
      {signatureSection}
      {quoteSection}
      {attachmentsSection}

      {/* Footer */}
      <div className="bg-gray-50 border-t border-gray-200">
        <div className="flex items-center justify-between px-3 pt-2 pb-0 md:hidden">
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              外部に送信されます
            </p>
            <span className="hidden md:block">{syncStatus}</span>
          </div>
          <div className="flex items-center gap-1.5">{aiBtn}{cancelBtn}{sendBtn}</div>
        </div>
      </div>

      {error && (
        <div className="px-3 pb-2">
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        </div>
      )}
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
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40">
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
