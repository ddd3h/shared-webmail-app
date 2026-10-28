import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';

// POST: create a user. Only a system administrator may (the first account of an empty system is the one exception, and then it is an administrator).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, email, password, role } = body;
  if (!name || !email || !password) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const first = (await prisma.users.count()) === 0;
  if (!first && !(await adminActor())) return forbidden();
  const password_hash = await hashPassword(password);
  const user = await prisma.users.create({ data: { name, email, password_hash, role: first ? 'admin' : role === 'admin' ? 'admin' : 'user' } });
  await logAudit({ actionType: 'create_user', targetType: 'users', targetId: user.id });
  return NextResponse.json({ id: user.id, email: user.email });
}

