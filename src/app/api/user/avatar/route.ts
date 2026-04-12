import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { GET as getUserAvatar } from '@/app/api/users/[id]/avatar/route';

// GET /api/user/avatar — current user's avatar
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  
  // Directly call the [id] version's handler instead of redirecting
  return getUserAvatar(req, { params: Promise.resolve({ id: session!.userId }) });
}
