import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { latestDate } from '@/lib/passkey-policy';

// GET /api/admin/security/people - locked accounts, who can log in how (an authenticator app and/or passkeys), and when each person last logged in
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const [locked, people, passkeys, logins] = await Promise.all([
    prisma.users.findMany({ where: { locked_at: { not: null } }, select: { id: true, name: true, email: true, locked_at: true } }),
    prisma.users.findMany({ orderBy: { created_at: 'asc' }, select: { id: true, name: true, email: true, totp_enabled_at: true, last_login_at: true, created_at: true } }),
    prisma.passkey_credentials.groupBy({ by: ['user_id'], _count: { _all: true } }), // one grouped count instead of a count per person
    // users.last_login_at is only kept since it was added; the login history covers the earlier logins
    prisma.login_logs.groupBy({ by: ['user_id'], where: { success: true, user_id: { not: null } }, _max: { created_at: true } }),
  ]);
  const logged = new Map(logins.map(l => [l.user_id, l._max.created_at]));
  const keys = new Map(passkeys.map(p => [p.user_id, p._count._all]));
  return NextResponse.json({
    locked,
    people: people.map(p => ({ id: p.id, name: p.name, email: p.email, mfa: !!p.totp_enabled_at, passkeys: keys.get(p.id) ?? 0, created_at: p.created_at, last_login_at: latestDate(p.last_login_at, logged.get(p.id) ?? null) })),
  });
}
