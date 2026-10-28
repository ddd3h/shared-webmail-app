'use client';
import { useEffect, useState } from 'react';
import FoldCard from '@/components/mobile/FoldCard';

type Info = { name: string; email: string; is_admin: boolean; worker_type: string; withholding?: string | null; unit: string | null; position: string | null; mattermost_linked: boolean };

// Who the company has on file: name, e-mail, kind of work, unit and position, Mattermost link. Read only here; an administrator changes them.
export default function PersonalInfoSection() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => { fetch('/api/profile/info').then(r => (r.ok ? r.json() : null)).then(setInfo).catch(() => {}); }, []);

  const rows: [string, string][] = info ? [
    ['名前', info.name], ['メールアドレス', info.email], ['区分', info.worker_type], ...(info.withholding ? [['源泉徴収（所得税）', info.withholding] as [string, string]] : []),
    ['所属', info.unit ?? '未設定'], ['役職', info.position ?? '未設定'],
    ['システムの権限', info.is_admin ? '管理者' : '一般'], ['Mattermost連携', info.mattermost_linked ? '連携済み（通知のDMが届きます）' : '未連携'],
  ] : [];
  return (
    <FoldCard title="個人情報" label="個人情報" className="card p-5" bodyClass="space-y-4" defaultOpen>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-100 text-2xl font-bold text-gray-400">
          {info && (
            <img src={`/api/user/avatar?u=${encodeURIComponent(info.email)}`} alt={info.name} className="h-full w-full object-cover"
              onError={e => { e.currentTarget.style.display = 'none'; (e.currentTarget.parentElement as HTMLElement).textContent = info.name[0]?.toUpperCase() || '?'; }} />
          )}
        </div>
        {info && <div className="min-w-0"><div className="truncate text-lg font-semibold text-gray-900">{info.name}</div><div className="truncate text-sm text-gray-500">{info.email}</div></div>}
      </div>
      {!info ? <p className="text-sm text-gray-400">読み込み中…</p> : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => <div key={k}><dt className="mb-0.5 text-xs text-gray-500">{k}</dt><dd className="font-medium text-gray-900 wrap-break-word">{v}</dd></div>)}
        </dl>
      )}
      <p className="text-xs text-gray-400">名前・メールアドレス・区分・所属・役職・権限は管理者が、源泉徴収の欄は経理担当が登録します。変更が必要なときは管理者に依頼してください。</p>
    </FoldCard>
  );
}
