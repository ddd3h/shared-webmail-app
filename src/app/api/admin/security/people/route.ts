import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';

// GET /api/admin/security/people - locked accounts, and who can log in how (an authenticator app and/or passkeys)
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const [locked, people, passkeys] = await Promise.all([
    prisma.users.findMany({ where: { locked_at: { not: null } }, select: { id: true, name: true, email: true, locked_at: true } }),
    prisma.users.findMany({ orderBy: { created_at: 'asc' }, select: { id: true, name: true, email: true, totp_enabled_at: true } }),
    prisma.passkey_credentials.groupBy({ by: ['user_id'], _count: { _all: true } }), // one grouped count instead of a count per person
  ]);
  const keys = new Map(passkeys.map(p => [p.user_id, p._count._all]));
  return NextResponse.json({
    locked,
    people: people.map(p => ({ id: p.id, name: p.name, email: p.email, mfa: !!p.totp_enabled_at, passkeys: keys.get(p.id) ?? 0 })),
  });
}
