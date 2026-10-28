'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';
import { ACCOUNT_ITEMS, ADMIN_ITEM, APPROVALS_ITEM, NOTIFICATIONS_ITEM, TODO_ITEM, ORG_GROUP_LABEL, ORG_ITEMS, TRANSFERS_ITEM, AUTOFLOW_ITEM, WORK_GROUP_LABEL, WORK_ITEMS, isActivePath, iconPath, type NavItem } from './items';
import { logout, type NavUser } from './useNavUser';
import CountBadge from './CountBadge';
import { useNotificationCount } from '@/hooks/useNotificationCount';

const SHEET_MS = 280;
const SWIPE_CLOSE_PX = 80;

// The bottom bar has only the three things used all day; everything else is in the sheet behind メニュー.
const BAR_ITEMS: NavItem[] = [
  { href: '/threads', label: 'メール', icon: iconPath('mail') },
  { href: '/calendar', label: 'カレンダー', icon: iconPath('calendar') },
  { href: '/contacts', label: '連絡先', icon: iconPath('people') },
];

function BarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link href={item.href} className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-[10px] font-medium ${active ? 'text-blue-600' : 'text-gray-500'}`}>
      <Icon d={item.icon} className="w-7 h-7" strokeWidth={active ? 2.5 : 1.5} />
      {item.label}
    </Link>
  );
}

function SheetLink({ item, active, badge = 0 }: { item: NavItem; active: boolean; badge?: number }) {
  return (
    <Link href={item.href} className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors ${active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}>
      <Icon d={item.icon} />
      {item.label}
      <CountBadge count={badge} className="ml-auto" />
    </Link>
  );
}

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <p className="text-xs font-semibold text-gray-400 tracking-wider px-2 pt-2 pb-1">{children}</p>
);

// Slides up from the bottom; drag down to dismiss.
function useSheet(pathname: string) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function open() {
    if (timer.current) clearTimeout(timer.current);
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true))); // paint once before animating in
  }
  function close() {
    setShown(false);
    timer.current = setTimeout(() => setMounted(false), SHEET_MS);
  }
  useEffect(() => { if (mounted) close(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const touch = {
    onTouchStart: (e: React.TouchEvent) => { startY.current = e.touches[0].clientY; if (sheetRef.current) sheetRef.current.style.transition = 'none'; },
    onTouchMove: (e: React.TouchEvent) => { if (sheetRef.current) sheetRef.current.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - startY.current)}px)`; },
    onTouchEnd: (e: React.TouchEvent) => {
      if (sheetRef.current) { sheetRef.current.style.transition = ''; sheetRef.current.style.transform = ''; }
      if (e.changedTouches[0].clientY - startY.current > SWIPE_CLOSE_PX) close();
    },
  };
  return { mounted, shown, open, close, sheetRef, touch };
}

export default function MobileNav({ user }: { user: NavUser }) {
  const pathname = usePathname();
  const unreadNotifications = useNotificationCount();
  const sheet = useSheet(pathname);
  const active = (href: string) => isActivePath(pathname, href);
  const workItems = [...WORK_ITEMS, ...(user.canApprove ? [APPROVALS_ITEM] : []), ...(user.isFinance ? [TRANSFERS_ITEM, AUTOFLOW_ITEM] : [])];
  const otherItems = [TODO_ITEM, NOTIFICATIONS_ITEM, ...ACCOUNT_ITEMS, ...(user.isAdmin ? [ADMIN_ITEM] : [])];

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-200" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        <div className="flex">
          {BAR_ITEMS.map(i => <BarLink key={i.href} item={i} active={active(i.href)} />)}
          <button onClick={sheet.open} className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-[10px] font-medium ${sheet.mounted ? 'text-blue-600' : 'text-gray-500'}`}>
            <span className="relative">
              <Icon d={iconPath('menu')} className="w-7 h-7" strokeWidth={sheet.mounted ? 2.5 : 1.5} />
              {unreadNotifications > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-white" />}
            </span>
            メニュー
          </button>
        </div>
      </nav>

      {sheet.mounted && (
        <div className="md:hidden fixed inset-0 z-60 flex flex-col justify-end">
          <div className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${sheet.shown ? 'opacity-100' : 'opacity-0'}`} onClick={sheet.close} />
          <div
            ref={sheet.sheetRef} {...sheet.touch}
            className={`relative bg-white rounded-t-2xl shadow-xl transition-transform duration-300 ease-out will-change-transform max-h-[85vh] overflow-y-auto ${sheet.shown ? 'translate-y-0' : 'translate-y-full'}`}
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)' }}
          >
            <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-gray-300" /></div>
            <div className="px-4 pb-2">
              <p className="px-2 pb-1 text-sm font-semibold text-gray-900">メニュー{user.name && <span className="ml-2 text-xs font-normal text-gray-500">{user.name} さん</span>}</p>
              <SectionTitle>{WORK_GROUP_LABEL}</SectionTitle>
              <nav className="space-y-0.5">{workItems.map(i => <SheetLink key={i.href} item={i} active={active(i.href)} />)}</nav>
              <SectionTitle>{ORG_GROUP_LABEL}</SectionTitle>
              <nav className="space-y-0.5">{ORG_ITEMS.map(i => <SheetLink key={i.href} item={i} active={active(i.href)} />)}</nav>
              <SectionTitle>その他</SectionTitle>
              <nav className="space-y-0.5">{otherItems.map(i => <SheetLink key={i.href} item={i} active={active(i.href)} badge={i.href === NOTIFICATIONS_ITEM.href ? unreadNotifications : 0} />)}</nav>
              <div className="border-t border-gray-100 mt-2 pt-2">
                <button onClick={logout} className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
                  <Icon d={iconPath('logout')} />ログアウト
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
