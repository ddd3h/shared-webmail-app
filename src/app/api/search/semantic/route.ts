import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { embeddingEnabled } from '@/lib/embedding';

// GET /api/search/semantic - is the "意味検索" search available? (the search box shows its switch only then)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  return NextResponse.json({ enabled: embeddingEnabled() });
}
