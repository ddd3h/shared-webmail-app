import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

// POST: create user. If no users exist, allow without auth for bootstrap.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, email, password, role } = body;
  if (!name || !email || !password) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const count = await prisma.users.count();
  if (count > 0) {
    const session = await getSession();
    requireAuth(session);
  }
  const password_hash = await hashPassword(password);
  const user = await prisma.users.create({ data: { name, email, password_hash, role: role || 'admin' } });
  await logAudit({ actionType: 'create_user', targetType: 'users', targetId: user.id });
  return NextResponse.json({ id: user.id, email: user.email });
}

