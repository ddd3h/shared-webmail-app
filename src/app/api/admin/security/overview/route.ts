import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { serializeLogin } from '@/lib/security-view';

const DAY_MS = 24 * 3600 * 1000;
const TOP = 8;

// GET /api/admin/security/overview[?lite=1] - the last 24 hours at a glance: failed logins by address and by account, what was blocked.
// The counts and the "top" lists are made by the database (a grouped count each, from the success+created_at index), not by reading rows.
// `lite=1` is what the overview screen asks for; without it the answer also carries the accounts and the latest logins (older callers).
export async function GET(req: NextRequest) {
  if (!(await adminActor())) return forbidden();
  const lite = new URL(req.url).searchParams.get('lite') === '1';
  const since = new Date(Date.now() - DAY_MS);
  const failedSince = { success: false, created_at: { gt: since } };
  const now = new Date();

  const [failed, succeeded, topIps, topAccounts, events, blocks, lockedCount, sessions] = await Promise.all([
    prisma.login_logs.count({ where: failedSince }),
    prisma.login_logs.count({ where: { success: true, created_at: { gt: since } } }),
    prisma.login_logs.groupBy({ by: ['ip_address'], where: failedSince, _count: { _all: true }, orderBy: { _count: { ip_address: 'desc' } }, take: TOP }),
    prisma.login_logs.groupBy({ by: ['email'], where: failedSince, _count: { _all: true }, orderBy: { _count: { email: 'desc' } }, take: TOP }),
    prisma.security_events.findMany({ orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.ip_blocks.findMany({ where: { OR: [{ expires_at: null }, { expires_at: { gt: now } }] }, orderBy: { created_at: 'desc' } }),
    prisma.users.count({ where: { locked_at: { not: null } } }),
    prisma.sessions.count({ where: { expires_at: { gt: now } } }),
  ]);

  const body = {
    summary: { failed_24h: failed, succeeded_24h: succeeded, active_sessions: sessions, blocked: blocks.length, locked: lockedCount },
    top_ips: topIps.map(r => ({ key: r.ip_address, count: r._count._all })),
    top_accounts: topAccounts.map(r => ({ key: r.email, count: r._count._all })),
    events: events.map(e => ({ id: e.id, type: e.type, severity: e.severity, ip: e.ip, email: e.email, detail: e.detail ? JSON.parse(e.detail) : null, at: e.created_at })),
    blocks: blocks.map(b => ({ id: b.id, ip: b.ip, reason: b.reason, source: b.source, expires_at: b.expires_at, created_at: b.created_at })),
  };
  if (lite) return NextResponse.json(body);

  const [locked, people, passkeys, recent] = await Promise.all([
    prisma.users.findMany({ where: { locked_at: { not: null } }, select: { id: true, name: true, email: true, locked_at: true } }),
    prisma.users.findMany({ orderBy: { created_at: 'asc' }, select: { id: true, name: true, email: true, totp_enabled_at: true } }),
    prisma.passkey_credentials.groupBy({ by: ['user_id'], _count: { _all: true } }),
    prisma.login_logs.findMany({ orderBy: { created_at: 'desc' }, take: 30, include: { user: { select: { name: true } } } }),
  ]);
  const keys = new Map(passkeys.map(p => [p.user_id, p._count._all]));
  return NextResponse.json({
    ...body,
    locked,
    // who can log in how: an authenticator app (2FA) and/or passkeys. Nobody without either can use a password login while 2FA is required.
    people: people.map(p => ({ id: p.id, name: p.name, email: p.email, mfa: !!p.totp_enabled_at, passkeys: keys.get(p.id) ?? 0 })),
    recent_logins: recent.map(l => ({ ...serializeLogin(l), email: l.email, name: l.user?.name ?? null })),
  });
}
