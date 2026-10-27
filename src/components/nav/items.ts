// Everything the menus show, in one place. Desktop and mobile build their menus from these lists.
export type NavItem = { href: string; label: string; hint?: string; icon: string };

// SVG path data (24x24, stroke icons)
const ICON = {
  mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  calendar: 'M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  people: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  doc: 'M9 7h6m-6 4h6m-6 4h4M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z',
  wallet: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  plane: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
  bank: 'M3 10h18M5 10V7l7-4 7 4v3M6 10v8m4-8v8m4-8v8m4-8v8M3 21h18',
  download: 'M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  menu: 'M4 6h16M4 12h16M4 18h16',
  shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  org: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h2m2 0h2M9 13h2m2 0h2M9 17h2m2 0h2',
  star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  todo: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
};
export type IconName = keyof typeof ICON;
export const iconPath = (name: IconName) => ICON[name];

const item = (href: string, label: string, icon: IconName, hint?: string): NavItem => ({ href, label, icon: ICON[icon], hint });

// On a phone ToDo lives in the menu sheet (the bottom bar keeps only mail, calendar and contacts)
export const TODO_ITEM = item('/todos', 'ToDo', 'todo');

// Always visible in the top bar
export const MAIN_ITEMS: NavItem[] = [
  item('/threads', 'メール', 'mail'),
  item('/calendar', 'カレンダー', 'calendar'),
  TODO_ITEM,
  item('/contacts', '連絡帳', 'people'),
];

export const NOTIFICATIONS_ITEM = item('/notifications', '通知', 'bell');

// 「申請・給与」: everything about work and money
export const WORK_ITEMS: NavItem[] = [
  item('/work', '勤怠・給与', 'doc', '打刻・報告・給与明細・受取口座'),
  item('/expenses', '経費', 'wallet', '立替の申請と返金'),
  item('/trips', '出張', 'plane', '出張申請と日当の計算'),
  item('/payments', '振込申請', 'bank', '取引先への支払いの申請'),
];
export const TRANSFERS_ITEM = item('/transfers', '振込データ', 'download', '全銀ファイルの作成（経理）');

// Personal items; they live in the account menu
export const ACCOUNT_ITEMS: NavItem[] = [
  item('/scheduled', '予約送信', 'clock'),
  item('/profile', 'プロフィール', 'user'),
];
export const ADMIN_ITEM = item('/admin/settings', '管理', 'gear', 'ユーザー・メール・セキュリティ・各種設定');

// 「組織・人事」: the organisation chart and evaluations (everybody has at least their own evaluation)
export const ORG_ITEMS: NavItem[] = [
  item('/org', '組織', 'org', '部署・メンバー・役職'),
  item('/evaluations', '人事評価', 'star', '自己評価・メンバーの評価・結果'),
];
// Only for people who can decide on their team's requests
export const APPROVALS_ITEM = item('/approvals', 'チームの承認', 'check', 'メンバーの経費・出張の承認待ち');


export const WORK_GROUP_LABEL = '申請・給与';
export const ORG_GROUP_LABEL = '組織・人事';

// 管理 is one place with several screens (/admin/settings, /admin/users, /admin/security ...): all of them light up its menu entry
export const isActivePath = (pathname: string, href: string) => (href === '/' ? pathname === '/' : href.startsWith('/admin/') ? pathname.startsWith('/admin') : pathname.startsWith(href));
