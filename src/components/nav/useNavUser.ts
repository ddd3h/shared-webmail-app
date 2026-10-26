'use client';
import { useEffect, useState } from 'react';
import { forgetDeviceLogin } from '@/lib/device-key';

export type NavUser = { name: string; isAdmin: boolean; isFinance: boolean; canApprove: boolean };
const GUEST: NavUser = { name: '', isAdmin: false, isFinance: false, canApprove: false };

// Who is looking: decides which menu entries exist (管理 for admins, 振込データ for finance staff).
export function useNavUser(): NavUser {
  const [user, setUser] = useState<NavUser>(GUEST);
  useEffect(() => {
    fetch('/api/work/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setUser({ name: d.name ?? '', isAdmin: d.role === 'admin', isFinance: !!d.is_finance, canApprove: !!d.can_approve }); })
      .catch(() => {});
  }, []);
  return user;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  await forgetDeviceLogin(); // logging out is a decision: the installed app asks for the password next time
  window.location.href = '/login';
}
