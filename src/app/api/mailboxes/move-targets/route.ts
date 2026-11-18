import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { viewableMailboxWhere } from '@/lib/rbac';

// GET /api/mailboxes/move-targets - every shared mailbox a personal thread can be moved to.
// `viewable` says whether this person can look into it afterwards (the address is only shown for those they can).
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const [all, mine] = await Promise.all([
    prisma.mailboxes.findMany({ where: { type: 'team' }, select: { id: true, display_name: true, email_address: true }, orderBy: { display_name: 'asc' } }),
    prisma.mailboxes.findMany({ where: { type: 'team', ...viewableMailboxWhere(session.userId) }, select: { id: true } }),
  ]);
  const viewable = new Set(mine.map(m => m.id));
  return NextResponse.json({ items: all.map(m => ({ id: m.id, display_name: m.display_name, email_address: viewable.has(m.id) ? m.email_address : null, viewable: viewable.has(m.id) })) });
}
