'use client';
import DesktopNav from '@/components/nav/DesktopNav';
import MobileNav from '@/components/nav/MobileNav';
import { useNavUser } from '@/components/nav/useNavUser';
import { useAppBadge } from '@/hooks/useAppBadge';

// Top bar on desktop, bottom bar + sheet on phones. Which entries exist depends on who is signed in.
export default function Nav() {
  const user = useNavUser();
  useAppBadge();
  return (
    <>
      <DesktopNav user={user} />
      <MobileNav user={user} />
    </>
  );
}
