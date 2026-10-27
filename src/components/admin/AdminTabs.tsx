'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The screens of the 管理 area. Everything here is for system administrators only (the proxy and every API check it).
export const ADMIN_TABS = [
  { href: '/admin/settings', label: 'システム設定' },
  { href: '/admin/users', label: 'ユーザー' },
  { href: '/admin/mailboxes', label: 'メールアカウント' },
  { href: '/admin/spam', label: '迷惑メール' },
  { href: '/admin/security', label: 'セキュリティ' },
  { href: '/admin/operations', label: '運用ログ' },
] as const;

export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="管理メニュー" className="-mx-2 border-b border-gray-200 sm:mx-0">
      <ul className="flex gap-1 overflow-x-auto px-2 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ADMIN_TABS.map(t => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href} className="shrink-0">
              <Link
                href={t.href} aria-current={active ? 'page' : undefined}
                className={`block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors -mb-px ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
