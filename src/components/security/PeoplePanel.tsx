'use client';
import { useMemo, useState } from 'react';
import FoldCard from '@/components/mobile/FoldCard';
import { daysSince, lastLoginLabel, needsPasskeyCleanup } from '@/lib/passkey-policy';
import type { Person } from './types';

const STALE_DAYS = 30;
const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const day = (iso: string) => new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' });

// アカウントと端末: everybody's login methods and last login, the reset of a whole account, and a hand-written Mattermost note.
export default function PeoplePanel({ people, onChanged }: { people: Person[]; onChanged: () => void }) {
  const [oldestFirst, setOldestFirst] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);

  const now = useMemo(() => new Date(), []);
  const rows = useMemo(() => {
    if (!oldestFirst) return people;
    // never logged in first, then the longest ago
    const t = (p: Person) => (p.last_login_at ? new Date(p.last_login_at).getTime() : -Infinity);
    return [...people].sort((a, b) => t(a) - t(b));
  }, [people, oldestFirst]);
  const staleIds = people.filter(p => (daysSince(p.last_login_at ? new Date(p.last_login_at) : null, now) ?? Infinity) >= STALE_DAYS).map(p => p.id);

  const toggle = (id: string) => setPicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function resetMfa(p: Person) {
    if (!confirm(`${p.name} さんの2段階認証をリセットします。ログイン中の端末はすべてログアウトされ、次回のログインで設定し直します。よろしいですか？`)) return;
    await post(`/api/admin/security/users/${p.id}/mfa-reset`);
    onChanged();
  }

  async function resetAll(p: Person) {
    if (!confirm(`${p.name} さんのアカウントを全リセットします。\n\n・パスキー（${p.passkeys}件）と2段階認証を削除\n・パスワードを無効にする\n・ログイン中の端末をすべてログアウト\n\nそのうえで、新しいパスワードを決めるための1回限りのリンク（60分）を、本人にMattermostのDMで送ります。よろしいですか？`)) return;
    setBusy(true); setNote(null); setLink(null);
    const res = await post(`/api/admin/security/users/${p.id}/reset-all`);
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setNote({ tone: 'error', text: d.message ?? 'リセットできませんでした' }); return; }
    if (d.delivered) setNote({ tone: 'ok', text: `${p.name} さんをリセットし、再設定のリンクをMattermostのDMで送りました` });
    else { setNote({ tone: 'error', text: `${p.name} さんをリセットしましたが、Mattermostに送れませんでした。次のリンクを本人に伝えてください（60分・1回だけ有効）` }); setLink({ name: p.name, url: d.reset_url }); }
    onChanged();
  }

  async function sendNotice() {
    if (picked.size === 0 || !text.trim()) return;
    if (!confirm(`選んだ${picked.size}人にMattermostのDMを送ります。よろしいですか？`)) return;
    setBusy(true); setNote(null); setLink(null);
    const res = await post('/api/admin/security/notify', { userIds: [...picked], message: text });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setNote({ tone: 'error', text: '送れませんでした' }); return; }
    const failed = (d.results as { name: string; delivered: boolean }[]).filter(r => !r.delivered).map(r => r.name);
    setNote(failed.length === 0
      ? { tone: 'ok', text: `${d.delivered}人に送りました` }
      : { tone: 'error', text: `${d.delivered}人に送りました。送れなかった人: ${failed.join('、')}（Mattermostと連携していない可能性があります）` });
    if (failed.length === 0) { setText(''); setPicked(new Set()); }
  }

  return (
    <FoldCard title="ユーザーとログイン方法" label="ユーザーとログイン方法" defaultOpen badge={`未設定 ${people.filter(p => !p.mfa && p.passkeys === 0).length}人`}>
      <p className="text-xs text-gray-500">パスキーを登録した人は、パスワードではログインできません。パスワードでログインする人は、2段階認証が必要です。パスキーは1人1つまでで、2つ以上ある人には1つにするよう画面で案内しています。</p>

      {note && <p className={`rounded-lg border px-3 py-2 text-sm ${note.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`} role="status">{note.text}</p>}
      {link && <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs"><p className="mb-1 text-gray-500">{link.name} さんの再設定リンク</p><input readOnly value={link.url} onFocus={e => e.currentTarget.select()} className="input w-full font-mono" aria-label="再設定リンク" /></div>}

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={oldestFirst} onChange={e => setOldestFirst(e.target.checked)} />ログインが古い順に並べる</label>
        <span className="flex-1" />
        <button className="btn btn-secondary btn-sm" onClick={() => setPicked(new Set(staleIds))}>{STALE_DAYS}日以上ログインなし（{staleIds.length}人）を選ぶ</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setPicked(new Set(people.filter(p => needsPasskeyCleanup(p.passkeys)).map(p => p.id)))}>パスキー2つ以上を選ぶ</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>選択を外す</button>
      </div>

      <ul className="divide-y divide-gray-100">
        {rows.map(p => {
          const days = daysSince(p.last_login_at ? new Date(p.last_login_at) : null, now);
          const stale = days === null || days >= STALE_DAYS;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`${p.name}を選ぶ`} />
              <span className="min-w-32 flex-1">{p.name}<span className="ml-2 text-xs text-gray-400">{p.email}</span></span>
              <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${stale ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`} title={p.last_login_at ? `最終ログイン ${day(p.last_login_at)}` : `登録 ${day(p.created_at)}`}>
                最終ログイン {lastLoginLabel(p.last_login_at ? new Date(p.last_login_at) : null, now)}
              </span>
              <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${p.mfa ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{p.mfa ? '2段階認証 有効' : '2段階認証 未設定'}</span>
              <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${needsPasskeyCleanup(p.passkeys) ? 'bg-amber-50 text-amber-700' : p.passkeys > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>パスキー {p.passkeys}{needsPasskeyCleanup(p.passkeys) ? '（要整理）' : ''}</span>
              {p.mfa && <button onClick={() => resetMfa(p)} className="btn btn-secondary btn-sm" aria-label={`${p.name}の2段階認証をリセット`}>2段階認証をリセット</button>}
              <button onClick={() => resetAll(p)} disabled={busy} className="btn btn-secondary btn-sm" aria-label={`${p.name}のアカウントを全リセット`}>全リセット</button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-900">Mattermostで連絡する（{picked.size}人を選択中）</p>
        <textarea className="input w-full" rows={3} maxLength={2000} value={text} onChange={e => setText(e.target.value)} placeholder="例: パスキーを1つにしてください。プロフィールから、使わないものを削除できます。" aria-label="送るメッセージ" />
        <div className="flex items-center gap-2"><button className="btn btn-primary btn-sm" onClick={sendNotice} disabled={busy || picked.size === 0 || !text.trim()}>{busy ? '送信中…' : 'DMで送る'}</button><span className="text-xs text-gray-400">アプリ内の通知にも届きます</span></div>
      </div>
    </FoldCard>
  );
}
