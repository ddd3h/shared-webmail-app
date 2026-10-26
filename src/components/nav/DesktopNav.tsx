'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Dropdown from './Dropdown';
import Icon from './Icon';
import { ACCOUNT_ITEMS, ADMIN_ITEM, SECURITY_ITEM, APPROVALS_ITEM, MAIN_ITEMS, NOTIFICATIONS_ITEM, ORG_GROUP_LABEL, ORG_ITEMS, TRANSFERS_ITEM, WORK_GROUP_LABEL, WORK_ITEMS, isActivePath, iconPath, type NavItem } from './items';
import { logout, type NavUser } from './useNavUser';

const Chevron = () => <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>;

function TopLink({ item, pathname, iconOnly }: { item: NavItem; pathname: string; iconOnly?: boolean }) {
  const active = isActivePath(pathname, item.href);
  return (
    <Link
      href={item.href} aria-label={item.label} title={item.label} aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
        active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      }`}
    >
      {iconOnly ? <Icon d={item.icon} /> : item.label}
    </Link>
  );
}

// One row of a dropdown: icon, name, and (when there is one) a short line saying what it is for.
function MenuLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActivePath(pathname, item.href);
  return (
    <Link
      href={item.href} aria-current={active ? 'page' : undefined}
      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
    >
      <Icon d={item.icon} className="w-5 h-5 mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{item.label}</span>
        {item.hint && <span className={`block text-xs ${active ? 'text-blue-600' : 'text-gray-500'}`}>{item.hint}</span>}
      </span>
    </Link>
  );
}

const initialOf = (name: string) => (name.trim() ? [...name.trim()][0] : '?');

export default function DesktopNav({ user }: { user: NavUser }) {
  const pathname = usePathname();
  const workItems = [...WORK_ITEMS, ...(user.canApprove ? [APPROVALS_ITEM] : []), ...(user.isFinance ? [TRANSFERS_ITEM] : [])];
  const accountItems = user.isAdmin ? [...ACCOUNT_ITEMS, ADMIN_ITEM, SECURITY_ITEM] : ACCOUNT_ITEMS;

  return (
    <header className="hidden md:block sticky top-0 z-50 bg-white border-b border-gray-200 shadow-xs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center gap-2">
          <div className="flex items-center gap-2 shrink-0 mr-3">
            <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center"><span className="text-white text-xs font-bold">M</span></div>
            <span className="font-semibold text-gray-900 text-sm hidden xl:block">共有メールワークスペース</span>
          </div>

          <nav className="flex items-center gap-1">
            {MAIN_ITEMS.map(i => <TopLink key={i.href} item={i} pathname={pathname} />)}
            <Dropdown active={workItems.some(i => isActivePath(pathname, i.href))} trigger={<>{WORK_GROUP_LABEL}<Chevron /></>}>
              {workItems.map(i => <MenuLink key={i.href} item={i} pathname={pathname} />)}
            </Dropdown>
            <Dropdown active={ORG_ITEMS.some(i => isActivePath(pathname, i.href))} trigger={<>{ORG_GROUP_LABEL}<Chevron /></>}>
              {ORG_ITEMS.map(i => <MenuLink key={i.href} item={i} pathname={pathname} />)}
            </Dropdown>
          </nav>

          <div className="flex-1" />

          <TopLink item={NOTIFICATIONS_ITEM} pathname={pathname} iconOnly />
          <Dropdown align="right" ariaLabel="アカウントメニュー" trigger={
            <>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700">{initialOf(user.name)}</span>
              <Chevron />
            </>
          }>
            {user.name && <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100 mb-1">{user.name} さん</div>}
            {accountItems.map(i => <MenuLink key={i.href} item={i} pathname={pathname} />)}
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                <Icon d={iconPath('logout')} />ログアウト
              </button>
            </div>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
