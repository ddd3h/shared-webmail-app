'use client';
import { use, useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ComposeForm, { type SendPayload } from '@/components/ComposeForm';

type Props = { params: Promise<{ id: string }> };

type Message = {
  id: string;
  direction: 'incoming' | 'outgoing';
  from: { name: string | null; email: string };
  to: string;
  cc: string | null;
  subject: string;
  sent_at: string;
  text_body: string | null;
  html_body: string | null;
  has_attachments: boolean;
  attachments: { id: string; filename: string; size: number; content_type: string }[];
};

type ThreadData = {
  id: string;
  subject: string;
  status: string;
  permissions: { can_view: boolean; can_reply: boolean; can_assign: boolean };
  mailbox: { id: string; name: string; type: string; email_address?: string; mattermost_channel_id?: string | null };
  assigned_user: { id: string; name: string } | null;
  last_replied_by: { id: string; name: string } | null;
  mattermost: string | null;
  messages: Message[];
  unread_count: number;
};

type User = { id: string; name: string; email: string };

// Shared mail only: 3 statuses
const STATUS_OPTIONS = [
  { value: 'open', label: '未対応' },
  { value: 'in_progress', label: '対応中' },
  { value: 'done', label: '完了' },
];

const STATUS_CHIP: Record<string, string> = {
  open: 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100',
  waiting: 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100',
  archived: 'bg-gray-100 text-gray-400 ring-gray-200 hover:bg-gray-200'
};

const STATUS_LABELS: Record<string, string> = {
  open: '未対応', in_progress: '対応中', waiting: '対応中', done: '完了', archived: 'アーカイブ'
};

function formatDate(d: string) {
  return new Date(d).toLocaleString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function getInitial(msg: Message) {
  if (msg.direction === 'outgoing') return '送';
  return (msg.from.name?.[0] || msg.from.email[0]).toUpperCase();
}

// Detect if HTML email contains quoted/previous content
function htmlHasQuote(html: string): boolean {
  return /<blockquote/i.test(html)
    || /class="gmail_quote"/i.test(html)
    || /class="gmail_extra"/i.test(html)
    || /class="yahoo_quoted"/i.test(html)
    || /id="divRplyFwdMsg"/i.test(html)
    || /id="appendonsend"/i.test(html);
}

// Find the line index where quoted content begins in plain text
function findTextQuoteBoundary(text: string): number | null {
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Classic "> " quoting
    if (line.startsWith('>')) {
      return i > 1 && lines[i - 1].trim() === '' ? i - 1 : i;
    }
    // "On [date], [name] wrote:" (single or two-line version)
    const twoLine = line + ' ' + (lines[i + 1] || '');
    if (/^On .{5,250} wrote:\s*$/.test(twoLine) || /^On .{5,250} wrote:\s*$/.test(line)) {
      return i > 1 && lines[i - 1].trim() === '' ? i - 1 : i;
    }
    // Outlook-style separators
    if (/_{10,}/.test(line) || /^-{5,}\s*(Original Message|転送済みのメッセージ)\s*-{5,}$/i.test(line)) {
      return i > 1 && lines[i - 1].trim() === '' ? i - 1 : i;
    }
  }
  return null;
}

function MessageBody({ html, text }: { html: string | null; text: string | null }) {
  const [quoteExpanded, setQuoteExpanded] = useState(false);

  if (html) {
    const hasQuote = htmlHasQuote(html);
    return (
      <div>
        <div
          className={`prose prose-sm max-w-none text-gray-700 overflow-x-auto ${!quoteExpanded && hasQuote ? 'email-quotes-hidden' : ''}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {hasQuote && (
          <button
            onClick={() => setQuoteExpanded(v => !v)}
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            <span className="tracking-widest leading-none">···</span>
            {quoteExpanded ? '引用を閉じる' : '前のメールを表示'}
          </button>
        )}
      </div>
    );
  }

  if (text) {
    const boundary = findTextQuoteBoundary(text);
    if (boundary === null) {
      return <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">{text}</pre>;
    }
    const lines = text.split('\n');
    const main = lines.slice(0, boundary).join('\n').trimEnd();
    const quote = lines.slice(boundary).join('\n');
    return (
      <div>
        <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">{main}</pre>
        <button
          onClick={() => setQuoteExpanded(v => !v)}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
        >
          <span className="tracking-widest leading-none">···</span>
          {quoteExpanded ? '引用を閉じる' : '前のメールを表示'}
        </button>
        {quoteExpanded && (
          <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-400 font-sans leading-relaxed border-l-2 border-gray-200 pl-3">
            {quote}
          </pre>
        )}
      </div>
    );
  }

  return <p className="text-sm text-gray-400 italic">本文なし</p>;
}

// Inline dropdown component
function InlineDropdown({ trigger, children, align = 'left' }: { trigger: React.ReactNode; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(v => !v)}>{trigger}</div>
      {open && (
        <div className={`absolute top-full mt-1 z-50 min-w-max bg-white border border-gray-200 rounded-lg shadow-xl py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div onClick={() => setOpen(false)}>{children}</div>
        </div>
      )}
    </div>
  );
}

export default function ThreadDetailPage({ params }: Props) {
  const { id } = use(params);
  const [data, setData] = useState<ThreadData | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showReply, setShowReply] = useState(false);
  const [replyInitialTo, setReplyInitialTo] = useState<string[]>([]);
  const [replyInitialCc, setReplyInitialCc] = useState<string[]>([]);
  const [replyQuote, setReplyQuote] = useState<{ header: string; html: string } | null>(null);
  const lastIncomingIdRef = useRef('');
  const [showForward, setShowForward] = useState(false);
  const [forwardInitialBody, setForwardInitialBody] = useState('');
  const [forwardInitialSubject, setForwardInitialSubject] = useState('');
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set());
  const [expandedInfo, setExpandedInfo] = useState<Set<string>>(new Set());
  const [mmChannelId, setMmChannelId] = useState('');
  const [showMmPanel, setShowMmPanel] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [teamMailboxes, setTeamMailboxes] = useState<{ id: string; display_name: string; email_address: string }[]>([]);
  const [moveTarget, setMoveTarget] = useState('');
  const [moving, setMoving] = useState(false);
  const [moveStep, setMoveStep] = useState<'idle' | 'transferring' | 'done'>('idle');
  const [discussPosting, setDiscussPosting] = useState(false);
  const router = useRouter();
  const replyBoxRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const load = useCallback(async () => {
    const [tRes, uRes] = await Promise.all([
      fetch(`/api/threads/${id}`),
      fetch('/api/users')
    ]);
    if (!tRes.ok) { router.push('/threads'); return; }
    const tData = await tRes.json();
    const uData = await uRes.json();
    setData(tData);
    setUsers(uData.items || []);
    if (tData.messages?.length) {
      const lastId = tData.messages[tData.messages.length - 1].id;
      setExpandedMsgs(new Set([lastId]));
    }
    setLoading(false);
    // Always mark as read when opening a thread
    fetch(`/api/threads/${id}/read`, { method: 'POST' }).catch(() => {});
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function onScroll() {
      const scrollY = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      setShowScrollTop(scrollY > 300);
      setShowScrollBottom(maxScroll - scrollY > 300);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function flashMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  }

  function openReply() {
    const mailboxEmail = data?.mailbox?.email_address;
    const lastIncoming = data?.messages?.slice().reverse().find(
      m => m.direction === 'incoming' && m.from.email !== mailboxEmail
    );
    const replyTarget = lastIncoming || data?.messages?.[data.messages.length - 1];
    lastIncomingIdRef.current = replyTarget?.id || '';
    if (lastIncoming) {
      setReplyInitialTo([lastIncoming.from.email]);
      setReplyInitialCc((lastIncoming.cc || '').split(/,\s*/).map((s: string) => s.trim()).filter(Boolean));
      const qHtml = lastIncoming.html_body
        || `<pre style="white-space:pre-wrap;font-family:inherit">${lastIncoming.text_body || ''}</pre>`;
      setReplyQuote({ header: `${formatDate(lastIncoming.sent_at)}、${lastIncoming.from.name || lastIncoming.from.email || ''}:`, html: qHtml });
    } else {
      setReplyInitialTo([]);
      setReplyInitialCc([]);
      setReplyQuote(null);
    }
    setShowReply(true);
    setTimeout(() => replyBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function handleReplySend(payload: SendPayload): Promise<string | null> {
    const msgId = lastIncomingIdRef.current;
    if (!msgId) return '返信対象のメッセージが見つかりません';
    const fd = new FormData();
    fd.append('html', payload.html);
    fd.append('text', payload.text);
    if (payload.mailboxId) fd.append('fromMailboxId', payload.mailboxId);
    if (payload.to.length) fd.append('to', JSON.stringify(payload.to));
    if (payload.cc.length) fd.append('cc', JSON.stringify(payload.cc));
    if (payload.bcc.length) fd.append('bcc', JSON.stringify(payload.bcc));
    payload.files.forEach(f => fd.append('file', f));
    const res = await fetch(`/api/messages/${msgId}/reply`, { method: 'POST', body: fd });
    if (res.ok) {
      flashMsg('success', '返信を送信しました');
      await load();
      return null;  // ComposeForm calls onCancel (=setShowReply(false)) after contact prompt
    }
    return '送信に失敗しました';
  }

  function openForward() {
    if (!data) return;
    const lastMsg = data.messages[data.messages.length - 1];
    const body = lastMsg
      ? `<p></p><p style="color:#6b7280;font-size:12px">---- 転送メッセージ ----<br>送信元: ${lastMsg.from.name || lastMsg.from.email}<br>日付: ${formatDate(lastMsg.sent_at)}<br>件名: ${data.subject || ''}<br>宛先: ${lastMsg.to}</p><blockquote style="border-left:3px solid #d1d5db;margin:8px 0;padding:4px 12px;color:#6b7280">${lastMsg.html_body || `<pre style="white-space:pre-wrap;font-family:inherit">${lastMsg.text_body || ''}</pre>`}</blockquote>`
      : '';
    setForwardInitialBody(body);
    setForwardInitialSubject(`Fw: ${data.subject || ''}`);
    setShowForward(true);
    setTimeout(() => replyBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function handleForwardSend(payload: SendPayload): Promise<string | null> {
    const fd = new FormData();
    fd.append('to', JSON.stringify(payload.to));
    if (payload.cc.length) fd.append('cc', JSON.stringify(payload.cc));
    if (payload.bcc.length) fd.append('bcc', JSON.stringify(payload.bcc));
    fd.append('subject', payload.subject);
    fd.append('html', payload.html);
    fd.append('text', payload.text);
    fd.append('mailbox_id', payload.mailboxId || data!.mailbox.id);
    payload.files.forEach(f => fd.append('file', f));
    const res = await fetch('/api/messages/compose', { method: 'POST', body: fd });
    if (res.ok) { flashMsg('success', '転送しました'); return null; }  // ComposeForm calls onCancel after contact prompt
    return '転送に失敗しました';
  }

  async function changeAssign(userId: string) {
    const res = await fetch(`/api/threads/${id}/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId || null })
    });
    if (res.ok) { flashMsg('success', '担当を変更しました'); await load(); }
    else flashMsg('error', '担当変更に失敗しました');
  }

  async function changeStatus(status: string) {
    const res = await fetch(`/api/threads/${id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) { flashMsg('success', 'ステータスを変更しました'); await load(); }
    else flashMsg('error', 'ステータス変更に失敗しました');
  }

  async function markUnread() {
    const res = await fetch(`/api/threads/${id}/unread`, { method: 'POST' });
    if (res.ok) { router.push('/threads'); }
    else flashMsg('error', '未読にするのに失敗しました');
  }

  async function deleteThread() {
    const confirmMsg = isTeam
      ? '全ユーザーからこのメールは削除されますが、本当に削除してもいいですか？\nこの操作は元に戻せません。'
      : 'このスレッドとすべてのメッセージを完全に削除しますか？\nこの操作は元に戻せません。';
    if (!confirm(confirmMsg)) return;
    const res = await fetch(`/api/threads/${id}/delete`, { method: 'POST' });
    if (res.ok) { router.push('/threads'); }
    else flashMsg('error', '削除に失敗しました');
  }

  async function openMoveModal() {
    const res = await fetch('/api/mailboxes').then(r => r.json()).catch(() => ({ items: [] }));
    const team = (res.items || []).filter((m: any) => m.type === 'team');
    setTeamMailboxes(team);
    setMoveTarget(team[0]?.id || '');
    setShowMoveModal(true);
  }

  async function moveThread() {
    if (!moveTarget) return;
    setMoving(true);
    setMoveStep('transferring');
    const start = Date.now();
    const res = await fetch(`/api/threads/${id}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_mailbox_id: moveTarget })
    });
    // Minimum 1 second display
    const elapsed = Date.now() - start;
    if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
    setMoveStep('done');
    if (res.ok) {
      await new Promise(r => setTimeout(r, 700));
      setMoving(false);
      setShowMoveModal(false);
      setMoveStep('idle');
      router.push(`/threads/${id}`);
      await load();
    } else {
      setMoving(false);
      setMoveStep('idle');
      const d = await res.json().catch(() => ({}));
      flashMsg('error', `移動に失敗しました: ${d.error || ''}`);
    }
  }

  async function postMattermostDiscuss() {
    if (!data?.mailbox.mattermost_channel_id) {
      flashMsg('error', 'このメールアカウントにはMattermostチャンネルが設定されていません');
      return;
    }
    setDiscussPosting(true);
    const res = await fetch(`/api/threads/${id}/mattermost/discuss`, { method: 'POST' });
    setDiscussPosting(false);
    if (res.ok) {
      const d = await res.json();
      flashMsg('success', 'Mattermostに投稿しました');
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      const errMap: Record<string, string> = {
        no_channel_configured: 'チャンネルIDが設定されていません',
        mattermost_not_configured: 'Mattermost Bot Tokenが設定されていません',
        mattermost_api_error: 'Mattermost APIエラー',
      };
      flashMsg('error', errMap[d.error] || 'Mattermostへの投稿に失敗しました');
    }
  }

  async function forwardMattermost() {
    const res = await fetch(`/api/threads/${id}/mattermost/forward`, { method: 'POST' });
    if (res.ok) flashMsg('success', 'Mattermostに転送しました');
    else flashMsg('error', '転送に失敗しました');
  }

  async function createMattermostLink() {
    if (!mmChannelId.trim()) return;
    const res = await fetch(`/api/threads/${id}/mattermost/link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: mmChannelId })
    });
    if (res.ok) { flashMsg('success', 'Mattermost議論を作成しました'); setShowMmPanel(false); await load(); }
    else flashMsg('error', '作成に失敗しました');
  }

  function toggleMsg(msgId: string) {
    setExpandedMsgs(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="max-w-full py-16 text-center">
        <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-full text-center py-16">
        <p className="text-gray-500 mb-4">スレッドが見つかりません</p>
        <Link href="/threads" className="btn btn-primary">一覧に戻る</Link>
      </div>
    );
  }

  const isTeam = data.mailbox.type === 'team';
  const canReply = data.permissions.can_reply;
  const canAssign = data.permissions.can_assign;

  return (
    <div className="max-w-full pb-6 -mt-6 md:mt-0">
      {/* Toast */}
      {msg && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-xl transition-all ${msg.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {msg.text}
        </div>
      )}

      {/* Sticky header */}
      <div className="sticky top-0 md:top-14 z-30 bg-white/95 backdrop-blur border-b border-gray-200 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-0 mb-4 shadow-sm">
        <div>
          {/* Top row: back + subject + reply */}
          <div className="flex items-center gap-3 py-3 border-b border-gray-100">
            <Link
              href="/threads"
              onClick={() => sessionStorage.setItem('threads-scroll', '0')}
              className="flex-shrink-0 inline-flex items-center gap-1 text-sm text-gray-400 hover:text-blue-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline text-xs">受信トレイ</span>
            </Link>

            <h1 className="flex-1 min-w-0 text-sm font-semibold text-gray-900 leading-snug line-clamp-1">
              {data.subject || '(件名なし)'}
            </h1>

            {canReply ? (
              <button onClick={openReply} className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-semibold shadow-md hover:shadow-lg hover:from-blue-600 hover:to-indigo-700 active:scale-95 transition-all duration-150 px-3 py-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                返信
              </button>
            ) : (
              <span className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gray-400 bg-gray-100 rounded-lg cursor-not-allowed" title="返信権限がありません">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                返信不可
              </span>
            )}
          </div>

          {/* Bottom row: status + assign + mailbox + actions */}
          <div className="flex items-center gap-2 py-2 min-w-0">
            {/* Mailbox badge */}
            <span
              title={data.mailbox.email_address || data.mailbox.name}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border flex-shrink-0 ${
                isTeam
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-violet-50 text-violet-700 border-violet-200'
              }`}
            >
              {isTeam ? (
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              ) : (
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
              {data.mailbox.name}
            </span>

            {/* Status dropdown (team only) */}
            {isTeam && (
              <InlineDropdown
                trigger={
                  <button className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset cursor-pointer transition-colors ${STATUS_CHIP[data.status] || ''}`}>
                    {STATUS_LABELS[data.status]}
                    <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                }
              >
                <div className="py-1 min-w-36">
                  <p className="px-3 py-1 text-xs font-medium text-gray-400">ステータス変更</p>
                  {STATUS_OPTIONS.map(s => (
                    <button
                      key={s.value}
                      onClick={() => changeStatus(s.value)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${data.status === s.value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      {data.status === s.value && (
                        <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {data.status !== s.value && <span className="w-3.5" />}
                      {s.label}
                    </button>
                  ))}
                </div>
              </InlineDropdown>
            )}

            {/* Assignee (team only) */}
            {isTeam && (
              canAssign ? (
                <InlineDropdown
                  trigger={
                    <button className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 cursor-pointer transition-colors">
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      {data.assigned_user ? data.assigned_user.name : '未担当'}
                      <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  }
                >
                  <div className="py-1 min-w-40">
                    <p className="px-3 py-1 text-xs font-medium text-gray-400">担当者を変更</p>
                    <button
                      onClick={() => changeAssign('')}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${!data.assigned_user ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                      {!data.assigned_user
                        ? <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        : <span className="w-3.5" />}
                      未担当
                    </button>
                    {users.map(u => (
                      <button
                        key={u.id}
                        onClick={() => changeAssign(u.id)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${data.assigned_user?.id === u.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        {data.assigned_user?.id === u.id
                          ? <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          : <span className="w-3.5" />}
                        {u.name}
                      </button>
                    ))}
                  </div>
                </InlineDropdown>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-400 border border-gray-200 cursor-not-allowed" title="担当変更権限がありません">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {data.assigned_user ? data.assigned_user.name : '未担当'}
                </span>
              )
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Action buttons — inline on desktop, collapsed into ⋯ on mobile */}

            {/* Desktop inline */}
            <div className="hidden sm:flex items-center gap-1.5">
              {!isTeam && (
                <button onClick={openMoveModal} title="チームメールに移動"
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 border border-amber-200 hover:border-amber-300 rounded-lg transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  移動
                </button>
              )}
              {isTeam && (
                <button onClick={postMattermostDiscuss} disabled={discussPosting} title="Mattermostで議論"
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50 border border-purple-200 hover:border-purple-300 rounded-lg transition-colors disabled:opacity-50">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                  </svg>
                  {discussPosting ? '投稿中…' : 'Mattermost'}
                </button>
              )}
              <button onClick={markUnread} title="未読にする"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                未読
              </button>
              <button onClick={openForward} title="転送"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-green-600 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                転送
              </button>
              <button onClick={deleteThread} title="削除"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 border border-red-200 hover:border-red-300 rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                削除
              </button>
            </div>

            {/* Mobile overflow ⋯ menu */}
            <div className="sm:hidden">
              <InlineDropdown align="right" trigger={
                <button className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="その他の操作">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                  </svg>
                </button>
              }>
                <div className="py-1 min-w-40">
                  {!isTeam && (
                    <button onClick={openMoveModal}
                      className="w-full text-left px-3 py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition-colors flex items-center gap-2.5">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      チームに移動
                    </button>
                  )}
                  {isTeam && (
                    <button onClick={postMattermostDiscuss} disabled={discussPosting}
                      className="w-full text-left px-3 py-2.5 text-sm text-purple-700 hover:bg-purple-50 transition-colors flex items-center gap-2.5 disabled:opacity-50">
                      <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                      </svg>
                      {discussPosting ? '投稿中…' : 'Mattermostで議論'}
                    </button>
                  )}
                  <button onClick={markUnread}
                    className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2.5">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    未読にする
                  </button>
                  <button onClick={openForward}
                    className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2.5">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    転送
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  <button onClick={deleteThread}
                    className="w-full text-left px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2.5">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    削除
                  </button>
                </div>
              </InlineDropdown>
            </div>
          </div>
        </div>
      </div>

      {/* Mattermost channel link panel */}
      {showMmPanel && (
        <div className="card p-3 mb-3 flex items-center gap-2 border-purple-200 bg-purple-50">
          <svg className="w-4 h-4 text-purple-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <input
            type="text"
            placeholder="MattermostチャンネルID"
            value={mmChannelId}
            onChange={e => setMmChannelId(e.target.value)}
            className="input flex-1 text-sm"
          />
          <button onClick={createMattermostLink} className="btn btn-primary btn-sm">作成</button>
          <button onClick={() => setShowMmPanel(false)} className="btn btn-secondary btn-sm">キャンセル</button>
        </div>
      )}

      {/* Message count + expand all */}
      {data.messages.length > 1 && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs text-gray-400">{data.messages.length} 件のメッセージ</span>
          <button
            onClick={() => setExpandedMsgs(
              expandedMsgs.size === data.messages.length
                ? new Set([data.messages[data.messages.length - 1].id])
                : new Set(data.messages.map(m => m.id))
            )}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            {expandedMsgs.size === data.messages.length ? 'すべて折りたたむ' : 'すべて展開'}
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="space-y-1.5">
        {data.messages.map((m, idx) => {
          const isExpanded = expandedMsgs.has(m.id);
          const isLast = idx === data.messages.length - 1;
          const isOut = m.direction === 'outgoing';

          return (
            <div key={m.id} className={`card overflow-hidden ${isOut ? 'border-l-4 border-l-blue-400' : ''} ${isLast ? 'shadow-md' : ''}`}>
              {/* Header row */}
              <div
                role="button"
                tabIndex={0}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${isExpanded ? 'bg-white' : 'hover:bg-gray-50'}`}
                onClick={() => toggleMsg(m.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMsg(m.id); } }}
              >
                {/* Avatar */}
                <div className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold ${isOut ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {getInitial(m)}
                </div>

                {/* From info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${isOut ? 'text-blue-700' : 'text-gray-900'}`}>
                      {isOut ? '送信済み' : (m.from.name || m.from.email)}
                    </span>
                    {isOut && <span className="text-xs text-gray-400">{m.from.email}</span>}
                    {!isExpanded && (
                      <span className="text-xs text-gray-400 truncate max-w-xs hidden sm:block">
                        {m.text_body?.slice(0, 80)}
                      </span>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <span>宛先: {m.to}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedInfo(prev => {
                            const next = new Set(prev);
                            if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                            return next;
                          });
                        }}
                        className="inline-flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                        title="詳細情報"
                      >
                        <svg className={`w-3 h-3 transition-transform ${expandedInfo.has(m.id) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Date + chevron */}
                <div className="flex-shrink-0 flex items-center gap-2">
                  <span className="text-xs text-gray-400 hidden sm:block whitespace-nowrap">{formatDate(m.sent_at)}</span>
                  {m.has_attachments && (
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  )}
                  <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Body */}
              {isExpanded && (
                <div className="border-t border-gray-100">
                  {/* Date on mobile */}
                  <div className="sm:hidden px-4 pt-2 text-xs text-gray-400">{formatDate(m.sent_at)}</div>

                  {/* Header info panel */}
                  {expandedInfo.has(m.id) && (
                    <div className="px-4 pt-2 pb-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-600 space-y-0.5">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        <span className="text-gray-400 font-medium">送信元:</span>
                        <span>{m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email}</span>
                        <span className="text-gray-400 font-medium">宛先:</span>
                        <span>{m.to}</span>
                        {m.cc && (
                          <>
                            <span className="text-gray-400 font-medium">CC:</span>
                            <span>{m.cc}</span>
                          </>
                        )}
                        <span className="text-gray-400 font-medium">日付:</span>
                        <span>{formatDate(m.sent_at)}</span>
                        <span className="text-gray-400 font-medium">件名:</span>
                        <span>{m.subject || data.subject}</span>
                      </div>
                    </div>
                  )}

                  {/* Message body */}
                  <div className="px-4 pt-3 pb-2">
                    <MessageBody html={m.html_body} text={m.text_body} />
                  </div>

                  {/* Attachments */}
                  {m.attachments.length > 0 && (
                    <div className="px-4 pb-3 pt-1 border-t border-gray-50">
                      <p className="text-xs font-medium text-gray-400 mb-2">添付ファイル ({m.attachments.length})</p>
                      <div className="flex flex-wrap gap-2">
                        {m.attachments.map(a => (
                          <a
                            key={a.id}
                            href={`/api/messages/${m.id}/attachment/${a.id}`}
                            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs hover:bg-gray-100 transition-colors group"
                          >
                            <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                            <span className="text-gray-700 font-medium">{a.filename}</span>
                            <span className="text-gray-400">{formatBytes(a.size)}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick reply link on last message */}
                  {isLast && !showReply && canReply && (
                    <div className="px-4 pb-3 pt-1 border-t border-gray-50 flex gap-2">
                      <button
                        onClick={openReply}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 rounded-lg px-3 py-1.5 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                        返信する
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reply composer */}
      <div ref={replyBoxRef} className="mt-4">
        {showReply ? (
          <ComposeForm
            mode="reply"
            defaultMailboxId={data?.mailbox?.id}
            initialTo={replyInitialTo}
            initialCc={replyInitialCc}
            quote={replyQuote}
            threadId={id}
            onSend={handleReplySend}
            onCancel={() => setShowReply(false)}
          />
        ) : canReply ? (
          <div
            onClick={openReply}
            className="card px-4 py-3 flex items-center gap-3 cursor-text hover:border-blue-300 hover:shadow-md transition-all group"
          >
            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </div>
            <span className="text-sm text-gray-400 group-hover:text-gray-600">返信を入力… （クリックして返信フォームを開く）</span>
          </div>
        ) : (
          <div className="card px-4 py-3 bg-gray-50 border-gray-200 text-center">
            <span className="text-sm text-gray-400">このメールボックスへの返信権限がありません</span>
          </div>
        )}
      </div>

      {/* Forward composer */}
      {showForward && (
        <div className="mt-4">
          <ComposeForm
            mode="forward"
            defaultMailboxId={data?.mailbox?.id}
            initialSubject={forwardInitialSubject}
            initialBody={forwardInitialBody}
            onSend={handleForwardSend}
            onCancel={() => setShowForward(false)}
          />
        </div>
      )}

      <div ref={bottomRef} />

      {/* Floating scroll buttons */}
      <div className="fixed right-6 bottom-8 flex flex-col gap-2 z-40">
        {showScrollTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="h-10 w-10 rounded-full bg-white border border-gray-200 shadow-lg flex items-center justify-center text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:shadow-xl transition-all"
            title="ページ先頭へ"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        )}
        {showScrollBottom && (
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="h-10 w-10 rounded-full bg-blue-600 shadow-lg flex items-center justify-center text-white hover:bg-blue-700 hover:shadow-xl transition-all"
            title="ページ末尾へ（返信フォーム）"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Move Thread Modal ── */}
      {showMoveModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-700">
            {moving ? (
              /* Transfer animation */
              <div className="p-8 flex flex-col items-center gap-6">
                <div className="relative flex items-center justify-center gap-4">
                  {/* Personal mailbox icon */}
                  <div className={`flex flex-col items-center gap-1 transition-all duration-700 ${moveStep === 'done' ? 'opacity-30 scale-90' : 'opacity-100 scale-100'}`}>
                    <div className="w-12 h-12 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
                      <svg className="w-6 h-6 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400">個人</span>
                  </div>

                  {/* Flow arrows */}
                  <div className="flex items-center gap-0.5">
                    {[0, 1, 2, 3].map(i => (
                      <div
                        key={i}
                        className={`w-2 h-2 rounded-full transition-all ${moveStep === 'done' ? 'bg-emerald-400' : 'bg-blue-400 animate-pulse'}`}
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                    <svg className={`w-4 h-4 ml-1 transition-colors ${moveStep === 'done' ? 'text-emerald-400' : 'text-blue-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {/* Team mailbox icon */}
                  <div className={`flex flex-col items-center gap-1 transition-all duration-700 ${moveStep === 'done' ? 'opacity-100 scale-110' : 'opacity-60 scale-100'}`}>
                    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-all duration-700 ${moveStep === 'done' ? 'bg-emerald-500/20 border-emerald-500/40' : 'bg-indigo-500/20 border-indigo-500/40'}`}>
                      <svg className={`w-6 h-6 transition-colors duration-700 ${moveStep === 'done' ? 'text-emerald-400' : 'text-indigo-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400">チーム</span>
                  </div>
                </div>

                <div className="text-center">
                  {moveStep === 'done' ? (
                    <>
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto mb-2">
                        <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <p className="text-white font-semibold">移動完了</p>
                      <p className="text-xs text-gray-400 mt-1">チームメールに移行しました</p>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mx-auto mb-2" />
                      <p className="text-white font-semibold">移行中…</p>
                      <p className="text-xs text-gray-400 mt-1">メールデータを移動しています</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* Confirm screen */
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">チームメールに移動</h3>
                    <p className="text-xs text-gray-400">個人メールから共有メールへ移行します</p>
                  </div>
                </div>

                <p className="text-sm text-gray-300 mb-4">
                  このメールスレッドをチームメールに移動すると、チームで共有・管理できるようになります。個人メールからは削除されます。
                </p>

                <div className="mb-5">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">移動先のチームメール</label>
                  {teamMailboxes.length === 0 ? (
                    <p className="text-sm text-red-400">チームメールがありません</p>
                  ) : (
                    <select
                      value={moveTarget}
                      onChange={e => setMoveTarget(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {teamMailboxes.map(m => (
                        <option key={m.id} value={m.id}>{m.display_name} ({m.email_address})</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowMoveModal(false)}
                    className="flex-1 px-4 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={moveThread}
                    disabled={!moveTarget || teamMailboxes.length === 0}
                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors disabled:opacity-40"
                  >
                    移動する
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
