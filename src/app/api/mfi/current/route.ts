import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { computeAndStoreMfi } from '../compute';

export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const data = await computeAndStoreMfi(session!.userId, session!.email);
  return NextResponse.json(data);
}
