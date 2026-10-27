'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FoldCard from '@/components/mobile/FoldCard';

type Status = {
  client_id: string | null; has_secret: boolean; connected: boolean; ready: boolean; company: { id: number; name: string | null } | null;
  walletable: { id: number; type: string; name?: string } | null; account_map: Record<string, { account_item_id: number; tax_code: number }>;
  auto_sync: boolean; sync_from: string | null; redirect_uri: string; kinds: Record<string, string>; expense_categories: string[];
};
type Options = { companies: { id: number; name: string }[]; walletables: { id: number; name: string; type: string }[]; account_items: { id: number; name: string }[] };
const RESULT: Record<string, string> = { connected: 'freeeに接続しました。会社・口座・勘定科目を選んでください', invalid_state: '接続を確認できませんでした。もう一度「freeeに接続」を押してください', denied: 'freeeで許可されませんでした', token_failed: 'freeeから許可の情報を受け取れませんでした。Client ID と Secret を確認してください' };
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// 連携: connect freee, choose the company, the bank account the money leaves from, and which account (勘定科目) each kind of money is booked as.
export default function FreeeSettingsCard() {
  const params = useSearchParams();
  const [st, setSt] = useState<Status | null>(null);
  const [opts, setOpts] = useState<Options | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [map, setMap] = useState<Record<string, { account_item_id: string; tax_code: string }>>({});
  const [syncFrom, setSyncFrom] = useState(today());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/freee');
    if (!r.ok) return;
    const d: Status = await r.json();
    setSt(d); setClientId(d.client_id ?? ''); setSyncFrom(d.sync_from ?? today());
    setMap(Object.fromEntries(Object.entries(d.account_map).map(([k, v]) => [k, { account_item_id: String(v.account_item_id), tax_code: String(v.tax_code) }])));
    if (d.connected) {
      const o = await fetch('/api/admin/freee/options');
      if (o.ok) setOpts(await o.json()); else setMsg({ ok: false, text: 'freeeから選択肢を取得できませんでした。接続し直してください' });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const f = params.get('freee'); if (f && RESULT[f]) setMsg({ ok: f === 'connected', text: RESULT[f] }); }, [params]);

  async function put(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/freee', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const e = await r.json().catch(() => ({}));
      if (r.ok) { setMsg({ ok: true, text: done }); setSecret(''); await load(); }
      else setMsg({ ok: false, text: e.error === 'not_ready' ? '会社・口座・連携の開始日を決めてから、自動送信をオンにしてください' : e.error === 'company_not_found' || e.error === 'walletable_not_found' ? 'freeeにその選択肢が見つかりません' : '保存できませんでした。入力を確認してください' });
    } finally { setBusy(false); }
  }
  async function saveMap() {
    const out: Record<string, { account_item_id: number; tax_code: number }> = {};
    for (const [k, v] of Object.entries(map)) if (v.account_item_id) out[k] = { account_item_id: Number(v.account_item_id), tax_code: Number(v.tax_code || 0) };
    await put({ account_map: out }, '勘定科目の割り当てを保存しました');
  }
  async function disconnect() {
    if (!confirm('freeeとの接続を外しますか？ これまでにfreeeへ送った取引はそのまま残ります。')) return;
    await fetch('/api/admin/freee', { method: 'DELETE' });
    setOpts(null); setMsg({ ok: true, text: '接続を外しました' }); await load();
  }
  const setM = (k: string, f: 'account_item_id' | 'tax_code', v: string) => setMap(m => ({ ...m, [k]: { account_item_id: m[k]?.account_item_id ?? '', tax_code: m[k]?.tax_code ?? '0', [f]: v } }));

  if (!st) return null;
  const rows: [string, string][] = [...Object.entries(st.kinds), ...st.expense_categories.map(c => [`expense:${c}`, `　経費: ${c}（個別に指定する場合）`] as [string, string])];
  return (
    <FoldCard title="freee連携" label="freee連携" badge={st.ready ? '連携中' : st.connected ? '設定中' : '未接続'} className="card p-6" bodyClass="">
      <div className="space-y-5">
        <p className="text-xs text-gray-500">支払い済みの給与・業務委託費・役員報酬・振込申請・経費の立替金を、実際に払った金額と日付で、freeeの「支出の取引（銀行口座からの支払）」として登録します。1件ずつ1回だけ送り、送れなかったものは「振込データ › freee連携」で確認・再送できます。</p>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">1. freeeアプリの情報</h3>
          <p className="text-xs text-gray-500">freeeの開発者向けサイトでアプリを作り、「コールバックURL」に下のURLを登録してください。</p>
          <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs break-all select-all" data-testid="freee-redirect-uri">{st.redirect_uri}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className="label" htmlFor="freee-client-id">Client ID</label><input id="freee-client-id" className="input font-mono text-xs" value={clientId} onChange={e => setClientId(e.target.value)} /></div>
            <div><label className="label" htmlFor="freee-secret">Client Secret</label><input id="freee-secret" type="password" autoComplete="off" className="input font-mono text-xs" value={secret} onChange={e => setSecret(e.target.value)} placeholder={st.has_secret ? '設定済み（変更するときだけ入力）' : ''} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={busy || !clientId.trim() || (!secret && !st.has_secret)} onClick={() => put({ client_id: clientId.trim(), ...(secret ? { client_secret: secret } : {}) }, 'アプリの情報を保存しました')}>アプリの情報を保存</button>
            {st.client_id && st.has_secret && <a className="btn" href="/api/freee/auth">{st.connected ? 'freeeに接続し直す' : 'freeeに接続'}</a>}
            {st.connected && <button type="button" className="btn" onClick={disconnect}>接続を外す</button>}
          </div>
        </div>

        {st.connected && opts && (
          <>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">2. 会社と、お金が出ていく口座</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div><label className="label" htmlFor="freee-company">会社（事業所）</label>
                  <select id="freee-company" className="input" value={st.company?.id ?? ''} onChange={e => put({ company_id: Number(e.target.value) }, '会社を選びました。口座と勘定科目を選び直してください')}>
                    <option value="">選んでください</option>{opts.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div><label className="label" htmlFor="freee-wallet">支払元の口座（振込をする銀行口座）</label>
                  <select id="freee-wallet" className="input" disabled={!st.company} value={st.walletable?.id ?? ''} onChange={e => { const w = opts.walletables.find(x => x.id === Number(e.target.value)); if (w) void put({ walletable: { id: w.id, type: w.type, name: w.name } }, '口座を選びました'); }}>
                    <option value="">選んでください</option>{opts.walletables.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select></div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">3. 勘定科目の割り当て</h3>
              <p className="text-xs text-gray-500">お金の種類ごとに、freeeの勘定科目を選びます。税区分は freee の税区分コード（0 = 対象外）で、税理士さんに確認してください。経費は科目ごとに選べ、選ばないものは「経費の立替金」の科目になります。</p>
              <div className="space-y-1.5">
                <div className="hidden sm:grid grid-cols-[16rem_1fr_6rem] gap-2 text-[11px] text-gray-400"><span>お金の種類</span><span>freeeの勘定科目</span><span className="text-right">税区分コード</span></div>
                {rows.map(([k, label]) => (
                  <div key={k} className="grid grid-cols-[1fr_auto_5rem] items-center gap-2 sm:grid-cols-[16rem_1fr_6rem]">
                    <label className="text-xs text-gray-700" htmlFor={`fm-${k}`}>{label}</label>
                    <select id={`fm-${k}`} className="input" value={map[k]?.account_item_id ?? ''} onChange={e => setM(k, 'account_item_id', e.target.value)} disabled={!st.company}>
                      <option value="">{k.startsWith('expense:') ? '（経費の立替金と同じ）' : '選んでください'}</option>{opts.account_items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <input aria-label={`${label}の税区分コード`} type="number" min={0} className="input text-right" value={map[k]?.tax_code ?? '0'} onChange={e => setM(k, 'tax_code', e.target.value)} />
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-primary" disabled={busy || !st.company} onClick={saveMap}>勘定科目を保存</button>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">4. 送る範囲と自動送信</h3>
              <div className="max-w-xs"><label className="label" htmlFor="freee-from">この日以降に支払ったものを送る</label>
                <div className="flex gap-2"><input id="freee-from" type="date" className="input" value={syncFrom} onChange={e => setSyncFrom(e.target.value)} />
                  <button type="button" className="btn" disabled={busy} onClick={() => put({ sync_from: syncFrom }, '連携の開始日を保存しました')}>開始日を保存</button></div>
                <p className="text-xs text-gray-400 mt-1">これより前の分は、すでにfreeeに入っている想定で送りません。</p></div>
              <label className="flex items-start gap-2 text-sm text-gray-900"><input type="checkbox" className="mt-1" checked={st.auto_sync} disabled={busy} onChange={e => put({ auto_sync: e.target.checked }, e.target.checked ? '自動送信をオンにしました' : '自動送信をオフにしました')} />
                <span>支払い済みになったら自動でfreeeに送る<span className="block text-xs text-gray-500">オフのときは「振込データ › freee連携」の「今すぐ送る」で送ります。</span></span></label>
            </div>
          </>
        )}
        {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
        <p className="text-xs text-gray-400">このカードの設定は、それぞれのボタンですぐ保存されます（画面下の「設定を保存」は押さなくて構いません）。</p>
      </div>
    </FoldCard>
  );
}
