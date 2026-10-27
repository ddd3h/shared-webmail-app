import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, requireAuth } from '@/lib/auth';
import { listTeamMailboxes, setHiddenTeamMailboxes } from '@/lib/team-view';

// GET /api/mailboxes/team-view - the shared mailboxes I may view, whether each is shown in my 共有メール, and its unread number
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  return NextResponse.json({ items: await listTeamMailboxes(session.userId) });
}

const schema = z.object({ hidden: z.array(z.string().min(1)).max(500) });

// PUT /api/mailboxes/team-view - choose which ones are left out (the rest are shown). At least one stays shown.
export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const r = await setHiddenTeamMailboxes(session.userId, parsed.data.hidden);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ items: await listTeamMailboxes(session.userId) });
}
