'use client';
import { useEffect, useState } from 'react';

export type NavUser = { name: string; isAdmin: boolean; isFinance: boolean };
const GUEST: NavUser = { name: '', isAdmin: false, isFinance: false };

// Who is looking: decides which menu entries exist (管理 for admins, 振込データ for finance staff).
export function useNavUser(): NavUser {
  const [user, setUser] = useState<NavUser>(GUEST);
  useEffect(() => {
    fetch('/api/work/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setUser({ name: d.name ?? '', isAdmin: d.role === 'admin', isFinance: !!d.is_finance }); })
      .catch(() => {});
  }, []);
  return user;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
}
