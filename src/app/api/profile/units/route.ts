import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { unitsOf } from '@/lib/org-server';

// GET /api/profile/units - the 部署 I belong to, with my 役職 in each (what I choose from when I apply for something)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  return NextResponse.json({ units: await unitsOf(session.userId) });
}
