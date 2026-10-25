import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { serializeLogin } from '@/lib/security-view';

// GET /api/security/login-history - the last logins (and failed tries) of MY account: where from, on what
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const rows = await prisma.login_logs.findMany({ where: { user_id: session.userId }, orderBy: { created_at: 'desc' }, take: 30 });
  return NextResponse.json({ items: rows.map(serializeLogin) });
}
