import { Suspense } from 'react';
import type { ReactNode } from 'react';
import AdminTabs from '@/components/admin/AdminTabs';

// 管理: one place, with a bar of screens (システム設定 / ユーザー / メールアカウント / 迷惑メール / セキュリティ / 運用ログ).
// Only system administrators get in (proxy.ts sends everybody else back to the top page; every /api/admin route checks too).
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5">
      <p className="text-xs font-medium tracking-wider text-gray-400">管理（システム管理者専用）</p>
      <Suspense fallback={<div aria-hidden className="h-11 border-b border-gray-200" />}><AdminTabs /></Suspense>
      {children}
    </div>
  );
}
