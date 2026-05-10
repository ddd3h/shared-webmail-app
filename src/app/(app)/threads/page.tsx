'use client';
import { Suspense, useEffect, useState, useRef } from 'react';
import useSWR from 'swr';
import { useRouter, useSearchParams } from 'next/navigation';
import ComposeForm, { type SendPayload } from '@/components/ComposeForm';

function ComposeModal({
  onClose,
  onSent,
  initialDraftId,
  initialTo,
  initialSubject,
}: {
  onClose: () => void;
  onSent: () => void;
  initialDraftId?: string;
  initialTo?: string[];
  initialSubject?: string;
}) {
  const [minimized, setMinimized] = useState(false);

  async function handleSend(payload: SendPayload): Promise<string | null> {
    const fd = new FormData();
    fd.append('mailbox_id', payload.mailboxId);
    fd.append('to', JSON.stringify(payload.to));
    if (payload.cc.length) fd.append('cc', JSON.stringify(payload.cc));
    if (payload.bcc.length) fd.append('bcc', JSON.stringify(payload.bcc));
    fd.append('subject', payload.subject);
    fd.append('html', payload.html);
    fd.append('text', payload.text);
    payload.files.forEach(f => fd.append('file', f));
    const res = await fetch('/api/messages/compose', { method: 'POST', body: fd });
    if (res.ok) { onSent(); return null; }  // ComposeForm calls onCancel (=onClose) after contact prompt
    const d = await res.json().catch(() => ({}));
    return d.error || '送信に失敗しました';
  }

  if (minimized) {
    return (
      <div className="fixed bottom-0 right-6 z-50 w-80 shadow-2xl rounded-t-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 text-white cursor-pointer hover:bg-gray-700 transition-colors" onClick={() => setMinimized(false)}>
          <span className="text-sm font-medium truncate">{initialDraftId ? '下書きを編集' : '新規メール作成'}</span>
          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={() => setMinimized(false)} className="p-1 rounded hover:bg-gray-600 transition-colors" title="展開">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-600 transition-colors" title="閉じる">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMinimized(true)} />
      <div className="relative w-full h-full sm:h-auto sm:max-w-5xl bg-white sm:rounded-2xl sm:shadow-2xl flex flex-col sm:max-h-[94vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0 bg-gray-800 sm:rounded-t-2xl">
          <h2 className="font-semibold text-white text-sm">{initialDraftId ? '下書きを編集' : '新規メール作成'}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setMinimized(true)} className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors" title="最小化">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
            </button>
            <button onClick={onClose} className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors" title="閉じる">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <ComposeForm
          mode="compose"
          draftId={initialDraftId}
          initialTo={initialTo}
          initialSubject={initialSubject}
          onSend={handleSend}
          onCancel={onClose}
        />
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

// ── Search helpers ──────────────────────────────────────────────────────────

const SEARCH_HISTORY_KEY = 'threads-search-history';
function getSearchHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); } catch { return []; }
}
function addSearchHistory(q: string) {
  if (!q.trim()) return;
  const h = getSearchHistory().filter(x => x !== q);
  h.unshift(q);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h.slice(0, 10)));
}

type SearchChipType = 'text'|'from'|'to'|'cc'|'bcc'|'subject'|'body'|'mailbox'|'status'|'assigned'|'after'|'before'|'attachment';
const CHIP_STYLE: Record<SearchChipType, string> = {
  text: 'bg-blue-100 text-blue-700 border-blue-200', from: 'bg-violet-100 text-violet-700 border-violet-200',
  to: 'bg-indigo-100 text-indigo-700 border-indigo-200', cc: 'bg-purple-100 text-purple-700 border-purple-200',
  bcc: 'bg-pink-100 text-pink-700 border-pink-200', subject: 'bg-sky-100 text-sky-700 border-sky-200',
  body: 'bg-cyan-100 text-cyan-700 border-cyan-200', mailbox: 'bg-amber-100 text-amber-700 border-amber-200',
  status: 'bg-emerald-100 text-emerald-700 border-emerald-200', assigned: 'bg-teal-100 text-teal-700 border-teal-200',
  after: 'bg-lime-100 text-lime-700 border-lime-200', before: 'bg-lime-100 text-lime-700 border-lime-200',
  attachment: 'bg-yellow-100 text-yellow-700 border-yellow-200',
};
const CHIP_PREFIX: Record<SearchChipType, string> = {
  text: '', from: '送信者:', to: '宛先:', cc: 'CC:', bcc: 'BCC:', subject: '件名:', body: '本文:',
  mailbox: 'MB:', status: 'ST:', assigned: '担当:', after: '以降:', before: '以前:', attachment: '',
};
function parseSearchChips(q: string): Array<{type: SearchChipType; value: string; raw: string}> {
  const chips: Array<{type: SearchChipType; value: string; raw: string}> = [];
  const prefixes: SearchChipType[] = ['from','to','cc','bcc','subject','body','mailbox','status','assigned','after','before'];
  for (const tok of q.trim().split(/\s+/)) {
    if (!tok) continue;
    if (tok.toLowerCase() === 'has:attachment') { chips.push({ type: 'attachment', value: '添付あり', raw: tok }); continue; }
    const ci = tok.indexOf(':');
    if (ci > 0) {
      const p = tok.toLowerCase().slice(0, ci) as SearchChipType;
      const v = tok.slice(ci + 1);
      if (v && prefixes.includes(p)) { chips.push({ type: p, value: v, raw: tok }); continue; }
    }
    chips.push({ type: 'text', value: tok, raw: tok });
  }
  return chips;
}
function removeChipFromQuery(q: string, raw: string): string {
  return q.split(/\s+/).filter(t => t !== raw).join(' ').trim();
}

// Contact autocomplete input used in filter panel
function ContactSuggestInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [suggestions, setSuggestions] = useState<{name: string; email: string}[]>([]);
  const [open, setOpen] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (value.length < 1) { setSuggestions([]); setOpen(false); return; }
    debRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(value)}`);
        const data = await res.json();
        const items = ((data.contacts || []) as {name: string; email: string}[]).filter(c => c.email).slice(0, 6);
        setSuggestions(items); setOpen(items.length > 0);
      } catch { setOpen(false); }
    }, 200);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [value]);
  return (
    <div className="relative">
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
      {open && (
        <div className="absolute z-20 top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button key={i} type="button" onMouseDown={e => { e.preventDefault(); onChange(s.email); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors">
              <span className="font-medium text-gray-800">{s.name}</span>
              <span className="ml-2 text-xs text-gray-400">{s.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

type DraftItem = {
  id: string;
  to_raw: string | null;
  subject: string | null;
  is_shared: boolean;
  updated_at: string;
  mailbox: { display_name: string; type: string } | null;
  user: { name: string };
};

const fetcher = (url: string) => fetch(url).then(r => r.json());

function buildThreadsKey(view: string, tab: string, q: string, cursor?: { last: string; id: string }) {
  const params = new URLSearchParams();
  params.set('type', view);
  if (tab === 'unread') params.set('unread', '1');
  else if (tab === 'mine') params.set('mine', '1');
  else if (tab === 'sent') params.set('sent', '1');
  else if (tab === 'assigned') params.set('assigned', '1');
  else if (tab && tab !== 'all') params.set('status', tab);
  if (q) params.set('q', q);
  if (cursor) { params.set('cursor', cursor.last); params.set('cursor_id', cursor.id); }
  return `/api/threads?${params}`;
}

function ThreadList() {
  const [initialized, setInitialized] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mailboxView, setMailboxView] = useState<'personal' | 'team'>('personal');
  const [tab, setTab] = useState('unread');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterCc, setFilterCc] = useState('');
  const [filterBcc, setFilterBcc] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterBody, setFilterBody] = useState('');
  const [filterMailbox, setFilterMailbox] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterAfter, setFilterAfter] = useState('');
  const [filterBefore, setFilterBefore] = useState('');
  const [filterAttachment, setFilterAttachment] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | undefined>(undefined);
  const [initialTo, setInitialTo] = useState<string[] | undefined>(undefined);
  const [initialSubject, setInitialSubject] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAllSelected, setIsAllSelected] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [modernConfirm, setModernConfirm] = useState<{ title: string, message: string, onConfirm: () => void } | null>(null);
  const [modernAlert, setModernAlert] = useState<{ title: string, message: string } | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<{ last: string; id: string }>>([]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const compose = searchParams.get('compose');
    const name = searchParams.get('name');
    const subjectParam = searchParams.get('subject');
    if (compose) {
      const to = name ? [`${name} <${compose}>`] : [compose];
      setInitialTo(to);
      if (subjectParam) setInitialSubject(subjectParam);
      setShowCompose(true);
      // Clean up URL
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete('compose');
      newParams.delete('name');
      newParams.delete('subject');
      const newQuery = newParams.toString();
      router.replace(`/threads${newQuery ? '?' + newQuery : ''}`);
    }
  }, [searchParams, router]);

  const currentCursor = cursorStack[cursorStack.length - 1];
  const isSearching = search.trim().length > 0;
  const threadsKey = initialized && tab !== 'drafts' && !isSearching ? buildThreadsKey(mailboxView, tab, search, currentCursor) : null;
  const searchPersonalKey = initialized && isSearching ? buildThreadsKey('personal', '', search) : null;
  const searchTeamKey = initialized && isSearching ? buildThreadsKey('team', '', search) : null;
  const draftsKey = initialized && tab === 'drafts' ? '/api/drafts' : null;
  const unreadCountsKey = initialized ? '/api/threads/unread-counts' : null;

  const { data: threadResult, isValidating: threadsValidating, mutate: mutateThreads } = useSWR(threadsKey, fetcher);
  const { data: searchPersonalResult, isValidating: searchPersonalValidating } = useSWR(searchPersonalKey, fetcher);
  const { data: searchTeamResult, isValidating: searchTeamValidating } = useSWR(searchTeamKey, fetcher);
  const { data: draftResult, isValidating: draftsValidating, mutate: mutateDrafts } = useSWR(draftsKey, fetcher);
  const { data: unreadResult } = useSWR(unreadCountsKey, fetcher);

  const threads: Thread[] = isSearching
    ? [...(searchPersonalResult?.items || []), ...(searchTeamResult?.items || [])]
        .sort((a, b) => new Date(b.last).getTime() - new Date(a.last).getTime())
    : threadResult?.items || [];
  const drafts: DraftItem[] = draftResult?.drafts || [];
  const nextCursor: { last: string; id: string } | null = (!isSearching && threadResult?.nextCursor) || null;
  const personalUnread: number = unreadResult?.personal || 0;
  const teamUnread: number = unreadResult?.team || 0;

  const isLoading = (tab !== 'drafts' && !isSearching && !threadResult && threadsValidating) ||
                    (isSearching && (searchPersonalValidating || searchTeamValidating) && !searchPersonalResult && !searchTeamResult) ||
                    (tab === 'drafts' && !draftResult && draftsValidating);

  useEffect(() => {
    if (isLoading) {
      spinnerTimerRef.current = setTimeout(() => setShowSpinner(true), 200);
    } else {
      if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
      setShowSpinner(false);
    }
    return () => { if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current); };
  }, [isLoading]);

  const selectionMode = selected.size > 0;
  const currentTabs = mailboxView === 'personal' ? PERSONAL_TABS : TEAM_TABS;

  function toggleSelect(id: string, index: number) {
    lastSelectedIndexRef.current = index;
    setIsAllSelected(false);
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
    setIsAllSelected(false);
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
      setIsAllSelected(false);
      lastSelectedIndexRef.current = null;
    } else {
      setSelected(new Set(threads.map(t => t.id)));
      setIsAllSelected(false);
    }
  }

  const totalCount = isSearching
    ? (searchPersonalResult?.totalCount || 0) + (searchTeamResult?.totalCount || 0)
    : threadResult?.totalCount || 0;

  async function performBulkAction(action: string, extra: any = {}) {
    const filters = {
      status: (!isSearching && (tab === 'all' || tab === 'unread' || tab === 'sent' || tab === 'mine' || tab === 'assigned')) ? undefined : tab,
      type: mailboxView,
      q: search || undefined,
      mine: tab === 'mine' ? '1' : '0',
      unread: tab === 'unread' ? '1' : '0',
      sent: tab === 'sent' ? '1' : '0',
      assigned: tab === 'assigned' ? '1' : '0'
    };

    // Pre-validation for delete
    if (action === 'delete') {
      const vres = await fetch('/api/threads/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ids: isAllSelected ? undefined : [...selected],
          all: isAllSelected,
          filters,
          validate_only: true
        })
      });
      const vdata = await vres.json();
      if (vdata.error === 'approval_required_warning') {
        setModernConfirm({
          title: '大量削除の承認リクエスト',
          message: vdata.message,
          onConfirm: () => executeBulkAction(action, filters, extra)
        });
        return;
      }
    }

    await executeBulkAction(action, filters, extra);
  }

  async function executeBulkAction(action: string, filters: any, extra: any = {}) {
    setBulkLoading(true);
    const res = await fetch('/api/threads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        status: extra.status,
        ids: isAllSelected ? undefined : [...selected],
        all: isAllSelected,
        filters
      })
    });

    const data = await res.json();
    if (data.message) {
      setModernAlert({
        title: data.ok ? '完了' : 'リクエスト完了',
        message: data.message
      });
    }

    setSelected(new Set());
    setIsAllSelected(false);
    setConfirmDelete(false);
    setBulkLoading(false);
    mutateThreads();
  }

  async function bulkMarkRead() { await performBulkAction('read'); }
  async function bulkMarkUnread() { await performBulkAction('unread'); }
  async function bulkSetStatus(status: string) { await performBulkAction('status', { status }); }
  async function bulkDelete() { await performBulkAction('delete'); }

  async function bulkDeleteDrafts() {
    if (!confirm(`${selected.size} 件の下書きを削除しますか？`)) return;
    setBulkLoading(true);
    await Promise.all([...selected].map(id =>
      fetch(`/api/drafts/${id}`, { method: 'DELETE' })
    ));
    setSelected(new Set());
    setBulkLoading(false);
    mutateDrafts();
  }

  // Restore scroll position when coming back
  useEffect(() => {
    const savedScroll = sessionStorage.getItem('threads-scroll');
    if (savedScroll && listRef.current) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedScroll));
        sessionStorage.removeItem('threads-scroll');
      });
    }
  }, [threadResult]);

  useEffect(() => {
    const urlView = searchParams.get('view') as 'personal' | 'team' | null;
    const savedView = (sessionStorage.getItem('threads-view') as 'personal' | 'team') || urlView || 'personal';
    const view = urlView ?? savedView;
    if (urlView) sessionStorage.setItem('threads-view', urlView);
    const savedTab = sessionStorage.getItem('threads-tab');
    sessionStorage.removeItem('threads-tab');
    const t = savedTab ?? searchParams.get('tab') ?? 'unread';
    setMailboxView(view);
    setTab(t);
    setInitialized(true);
  }, []);

  function resetFilters() {
    setSearchInput('');
    setFilterFrom(''); setFilterTo(''); setFilterCc(''); setFilterBcc('');
    setFilterSubject(''); setFilterBody(''); setFilterMailbox(''); setFilterStatus(''); setFilterAssigned('');
    setFilterAfter(''); setFilterBefore('');
    setFilterAttachment(false);
    setShowFilters(false);
    setShowHistory(false);
    setSearch('');
  }

  function switchView(view: 'personal' | 'team') {
    setMailboxView(view);
    setTab('unread');
    setCursorStack([]);
    resetFilters();
    setSelected(new Set());
    setConfirmDelete(false);
    lastSelectedIndexRef.current = null;
    sessionStorage.setItem('threads-view', view);
  }

  function switchTab(newTab: string) {
    setTab(newTab);
    setCursorStack([]);
    resetFilters();
    setSelected(new Set());
    setConfirmDelete(false);
    lastSelectedIndexRef.current = null;
  }

  function buildQuery() {
    const parts: string[] = [];
    if (searchInput.trim()) parts.push(searchInput.trim());
    if (filterFrom.trim()) parts.push(`from:${filterFrom.trim()}`);
    if (filterTo.trim()) parts.push(`to:${filterTo.trim()}`);
    if (filterCc.trim()) parts.push(`cc:${filterCc.trim()}`);
    if (filterBcc.trim()) parts.push(`bcc:${filterBcc.trim()}`);
    if (filterSubject.trim()) parts.push(`subject:${filterSubject.trim()}`);
    if (filterBody.trim()) parts.push(`body:${filterBody.trim()}`);
    if (filterMailbox.trim()) parts.push(`mailbox:${filterMailbox.trim()}`);
    if (filterStatus) parts.push(`status:${filterStatus}`);
    if (filterAssigned.trim()) parts.push(`assigned:${filterAssigned.trim()}`);
    if (filterAfter) parts.push(`after:${filterAfter}`);
    if (filterBefore) parts.push(`before:${filterBefore}`);
    if (filterAttachment) parts.push('has:attachment');
    return parts.join(' ');
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = buildQuery();
    addSearchHistory(q);
    setSearch(q);
    setSearchInput(q);
    setShowHistory(false);
    setTab('');
    setCursorStack([]);
  }

  function handleRemoveChip(raw: string) {
    const newSearch = removeChipFromQuery(search, raw);
    setSearch(newSearch);
    setSearchInput(newSearch);
    setCursorStack([]);
  }

  function clearSearch() {
    resetFilters();
    setCursorStack([]);
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
          onClose={() => { setShowCompose(false); setOpenDraftId(undefined); setInitialTo(undefined); setInitialSubject(undefined); }}
          onSent={() => { mutateThreads(); }}
          initialDraftId={openDraftId}
          initialTo={initialTo}
          initialSubject={initialSubject}
        />
      )}

      {modernConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 mb-4">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{modernConfirm.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{modernConfirm.message}</p>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex gap-3">
              <button
                onClick={() => setModernConfirm(null)}
                className="flex-1 px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => { modernConfirm.onConfirm(); setModernConfirm(null); }}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200"
              >
                リクエスト
              </button>
            </div>
          </div>
        </div>
      )}

      {modernAlert && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-4 ${
                modernAlert.title === '完了' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
              }`}>
                {modernAlert.title === '完了' ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{modernAlert.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{modernAlert.message}</p>
            </div>
            <div className="bg-gray-50 px-6 py-4">
              <button
                onClick={() => setModernAlert(null)}
                className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">メール</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCompose(true)}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-semibold shadow-md hover:shadow-lg hover:from-blue-600 hover:to-indigo-700 active:scale-95 transition-all duration-150 px-3 py-2 sm:px-4"
              title="新規メール作成"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="hidden sm:inline text-sm">新規メール</span>
            </button>
            <button
              onClick={() => { if (tab === 'drafts') mutateDrafts(); else mutateThreads(); }}
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
                placeholder="検索… (from: to: cc: subject: body: mailbox: status: assigned:)"
                value={searchInput}
                onChange={(e) => { setSearchInput(e.target.value); setShowHistory(false); }}
                onFocus={() => { if (!searchInput) { setSearchHistory(getSearchHistory()); setShowHistory(true); } }}
                onBlur={() => setTimeout(() => setShowHistory(false), 150)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
              {/* Search history dropdown */}
              {showHistory && searchHistory.length > 0 && (
                <div className="absolute z-20 top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
                    <span className="text-xs font-medium text-gray-400">検索履歴</span>
                    <button type="button" onMouseDown={e => { e.preventDefault(); localStorage.removeItem(SEARCH_HISTORY_KEY); setSearchHistory([]); setShowHistory(false); }}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors">クリア</button>
                  </div>
                  {searchHistory.map((h, i) => (
                    <button key={i} type="button" onMouseDown={e => {
                      e.preventDefault();
                      setSearchInput(h); setSearch(h); setShowHistory(false);
                      setTab(''); setCursorStack([]);
                    }} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="truncate">{h}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                showFilters || filterFrom || filterTo || filterCc || filterBcc || filterSubject || filterBody || filterMailbox || filterStatus || filterAssigned || filterAfter || filterBefore || filterAttachment
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
              {/* Row 1: From, To, CC */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">送信者 (from:)</label>
                  <ContactSuggestInput value={filterFrom} onChange={setFilterFrom} placeholder="名前またはアドレス" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">宛先 (to:)</label>
                  <ContactSuggestInput value={filterTo} onChange={setFilterTo} placeholder="名前またはアドレス" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">CC (cc:)</label>
                  <ContactSuggestInput value={filterCc} onChange={setFilterCc} placeholder="名前またはアドレス" />
                </div>
              </div>
              {/* Row 2: BCC, Subject, Body */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">BCC (bcc:)</label>
                  <input type="text" value={filterBcc} onChange={e => setFilterBcc(e.target.value)} placeholder="名前またはアドレス"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">件名 (subject:)</label>
                  <input type="text" value={filterSubject} onChange={e => setFilterSubject(e.target.value)} placeholder="件名キーワード"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">本文 (body:)</label>
                  <input type="text" value={filterBody} onChange={e => setFilterBody(e.target.value)} placeholder="本文キーワード"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
              </div>
              {/* Row 3: Mailbox, Status, Assigned */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">メールボックス (mailbox:)</label>
                  <input type="text" value={filterMailbox} onChange={e => setFilterMailbox(e.target.value)} placeholder="メールボックス名"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">ステータス (status:)</label>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                    <option value="">指定しない</option>
                    <option value="open">未対応</option>
                    <option value="in_progress">対応中</option>
                    <option value="done">完了</option>
                    <option value="waiting">保留</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">担当者 (assigned:)</label>
                  <input type="text" value={filterAssigned} onChange={e => setFilterAssigned(e.target.value)} placeholder="担当者名"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
              </div>
              {/* Row 4: Date range */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">期間（開始）</label>
                  <input type="date" value={filterAfter} onChange={e => setFilterAfter(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">期間（終了）</label>
                  <input type="date" value={filterBefore} onChange={e => setFilterBefore(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={filterAttachment} onChange={e => setFilterAttachment(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 border-gray-300" />
                添付ファイルあり
              </label>
            </div>
          )}

          {/* Active search chips */}
          {search && (
            <div className="flex flex-wrap gap-1.5 items-center">
              {parseSearchChips(search).map((chip, i) => (
                <span key={i} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium border ${CHIP_STYLE[chip.type]}`}>
                  {CHIP_PREFIX[chip.type] && <span className="opacity-60 text-[10px]">{CHIP_PREFIX[chip.type]}</span>}
                  <span>{chip.value}</span>
                  <button type="button" onClick={() => handleRemoveChip(chip.raw)}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 transition-colors flex-shrink-0">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </form>
      </div>

      {/* Segment switcher — hidden while searching */}
      <div className={`flex bg-gray-100 rounded-xl p-1 gap-1 mb-4 ${isSearching ? 'hidden' : ''}`}>
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

      {/* Tab bar — hidden while searching */}
      <div className={`border-b border-gray-200 mb-0 ${isSearching ? 'hidden' : ''}`}>
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
        <div className="bg-blue-600 border-x border-blue-600">
          {/* 常時表示行: チェックボックス + 件数 + [PC:アクション] + 閉じる */}
          <div className="flex items-center gap-2 px-4 py-2.5">
            <input
              type="checkbox"
              checked={selected.size === threads.length && threads.length > 0}
              ref={el => { if (el) el.indeterminate = !isAllSelected && selected.size > 0 && selected.size < threads.length; }}
              onChange={selectAll}
              className="w-4 h-4 rounded border-white/50 cursor-pointer accent-white flex-shrink-0"
            />
            <span className="text-sm font-semibold text-white whitespace-nowrap">
              {isAllSelected ? `全 ${totalCount} 件を選択中` : `${selected.size} 件選択`}
            </span>            <div className="flex-1" />

            {/* PC のみ表示するアクション群 */}
            {confirmDelete ? (
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-sm text-white/90 font-medium">
                  {mailboxView === 'team' ? '全ユーザーから削除されます。' : `${selected.size} 件を削除します。`}元に戻せません。
                </span>
                <button onClick={bulkDelete} disabled={bulkLoading} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                  {bulkLoading ? '削除中…' : '削除する'}
                </button>
                <button onClick={() => setConfirmDelete(false)} disabled={bulkLoading} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-400 border border-white/30 transition-colors">
                  キャンセル
                </button>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5">
                <button onClick={bulkMarkRead} disabled={bulkLoading} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/15 text-white hover:bg-white/25 border border-white/20 transition-colors disabled:opacity-50">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  既読
                </button>
                <button onClick={bulkMarkUnread} disabled={bulkLoading} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/15 text-white hover:bg-white/25 border border-white/20 transition-colors disabled:opacity-50">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /><circle cx="17" cy="17" r="4" fill="currentColor" stroke="none" /></svg>
                  未読
                </button>
                {mailboxView === 'team' && (
                  <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkSetStatus(e.target.value); e.target.value = ''; } }} disabled={bulkLoading} className="px-2 py-1.5 rounded-lg text-xs font-medium bg-white/15 text-white border border-white/20 cursor-pointer disabled:opacity-50 focus:outline-none" style={{ colorScheme: 'dark' }}>
                    <option value="" className="text-gray-900 bg-white">ステータス変更…</option>
                    <option value="open" className="text-gray-900 bg-white">未対応</option>
                    <option value="in_progress" className="text-gray-900 bg-white">対応中</option>
                    <option value="done" className="text-gray-900 bg-white">完了</option>
                  </select>
                )}
                <button onClick={() => setConfirmDelete(true)} disabled={bulkLoading} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/80 text-white hover:bg-red-500 border border-red-400/50 transition-colors disabled:opacity-50">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  削除
                </button>
              </div>
            )}

            <button
              onClick={() => { setSelected(new Set()); setConfirmDelete(false); lastSelectedIndexRef.current = null; }}
              className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition-colors ml-1 flex-shrink-0"
              title="選択解除"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* モバイルのみ: アクション行（2段目）— アイコンのみで1行に収める */}
          {confirmDelete ? (
            <div className="flex items-center gap-2 px-4 pb-2.5 sm:hidden">
              <span className="flex-1 text-xs text-white/90 font-medium truncate">
                {mailboxView === 'team' ? '全員から削除。' : `${selected.size}件削除。`}元に戻せません。
              </span>
              <button onClick={bulkDelete} disabled={bulkLoading} className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                {bulkLoading ? '削除中…' : '削除する'}
              </button>
              <button onClick={() => setConfirmDelete(false)} disabled={bulkLoading} className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-400 border border-white/30 transition-colors">
                戻る
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-4 pb-2.5 sm:hidden">
              <button onClick={bulkMarkRead} disabled={bulkLoading} title="既読にする" className="p-2 rounded-lg text-white bg-white/15 hover:bg-white/25 border border-white/20 transition-colors disabled:opacity-50">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              </button>
              <button onClick={bulkMarkUnread} disabled={bulkLoading} title="未読にする" className="p-2 rounded-lg text-white bg-white/15 hover:bg-white/25 border border-white/20 transition-colors disabled:opacity-50 relative">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-300 border border-blue-600" />
              </button>
              {mailboxView === 'team' && (
                <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkSetStatus(e.target.value); e.target.value = ''; } }} disabled={bulkLoading} className="w-16 px-1 py-2 rounded-lg text-xs font-medium bg-white/15 text-white border border-white/20 cursor-pointer disabled:opacity-50 focus:outline-none" style={{ colorScheme: 'dark' }}>
                  <option value="" className="text-gray-900 bg-white">状態</option>
                  <option value="open" className="text-gray-900 bg-white">未対応</option>
                  <option value="in_progress" className="text-gray-900 bg-white">対応中</option>
                  <option value="done" className="text-gray-900 bg-white">完了</option>
                </select>
              )}
              <button onClick={() => setConfirmDelete(true)} disabled={bulkLoading} title="削除" className="p-2 rounded-lg text-white bg-red-500/80 hover:bg-red-500 border border-red-400/50 transition-colors disabled:opacity-50">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          )}
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
                          mutateDrafts();
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
            {selected.size === threads.length && totalCount > threads.length && (
              <div className="bg-blue-50/80 px-4 py-2 text-center text-sm border-b border-blue-100">
                {isAllSelected ? (
                  <p className="text-gray-700">
                    このビューの全 {totalCount} 件のスレッドが選択されています。
                    <button onClick={() => { setIsAllSelected(false); setSelected(new Set()); }} className="ml-2 text-blue-600 font-medium hover:underline">
                      選択を解除
                    </button>
                  </p>
                ) : (
                  <p className="text-gray-700">
                    このページの {threads.length} 件のスレッドが選択されています。
                    <button onClick={() => setIsAllSelected(true)} className="ml-2 text-blue-600 font-medium hover:underline">
                      このビューの全 {totalCount} 件のスレッドを選択
                    </button>
                  </p>
                )}
              </div>
            )}
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
                        {isSearching
                          ? <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-500 font-medium">
                              {mailboxDot(t.mailbox_id, t.mailbox)}
                              <span className="truncate max-w-[80px]">{t.mailbox}</span>
                            </span>
                          : t.mailbox_type === 'team' && mailboxDot(t.mailbox_id, t.mailbox)
                        }
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
                      {isSearching
                        ? <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-500 font-medium whitespace-nowrap">
                            {mailboxDot(t.mailbox_id, t.mailbox)}
                            <span className="truncate max-w-[100px]">{t.mailbox}</span>
                          </span>
                        : t.mailbox_type === 'team' && mailboxDot(t.mailbox_id, t.mailbox)
                      }
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
                          <div className="flex-shrink-0 hidden sm:flex items-center -space-x-1.5">
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
                  setCursorStack(prev => prev.slice(0, -1));
                }}
                disabled={threadsValidating}
                className="btn btn-secondary btn-sm text-xs disabled:opacity-50 gap-1"
              >
                ← 前へ
              </button>
            )}
            {nextCursor && (
              <button
                onClick={() => {
                  setCursorStack(prev => [...prev, nextCursor!]);
                }}
                disabled={threadsValidating}
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
