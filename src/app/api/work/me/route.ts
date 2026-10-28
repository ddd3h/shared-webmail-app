import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, getWorkSettings, isFinance } from '@/lib/work-auth';
import { menuAccessOf } from '@/lib/org-server';

// GET /api/work/me - who am I (worker type decides which tabs are shown; the org flags decide which menu entries exist)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const [settings, access] = await Promise.all([getWorkSettings(), menuAccessOf(actor)]);
  return NextResponse.json({ ...actor, is_accounting: !!actor.is_accounting, is_finance: isFinance(actor), settings, ...access });
}
