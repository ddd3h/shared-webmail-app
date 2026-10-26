import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { serializeLogin } from '@/lib/security-view';

const DAY_MS = 24 * 3600 * 1000;
type Count = { key: string; count: number };

const top = (rows: { key: string | null }[], n = 8): Count[] => {
  const m = new Map<string, number>();
  for (const r of rows) if (r.key) m.set(r.key, (m.get(r.key) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));
};

// GET /api/admin/security/overview - the last 24 hours at a glance: failed logins by address and by account, what was blocked
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const since = new Date(Date.now() - DAY_MS);
  const [failed, succeeded, events, blocks, locked, sessions, recent, people] = await Promise.all([
    prisma.login_logs.findMany({ where: { success: false, created_at: { gt: since } }, select: { ip_address: true, email: true }, take: 5000 }),
    prisma.login_logs.count({ where: { success: true, created_at: { gt: since } } }),
    prisma.security_events.findMany({ orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.ip_blocks.findMany({ where: { OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] }, orderBy: { created_at: 'desc' } }),
    prisma.users.findMany({ where: { locked_at: { not: null } }, select: { id: true, name: true, email: true, locked_at: true } }),
    prisma.sessions.count({ where: { expires_at: { gt: new Date() } } }),
    prisma.login_logs.findMany({ orderBy: { created_at: 'desc' }, take: 30, include: { user: { select: { name: true } } } }),
    prisma.users.findMany({ orderBy: { created_at: 'asc' }, select: { id: true, name: true, email: true, totp_enabled_at: true, _count: { select: { passkey_credentials: true } } } }),
  ]);
  return NextResponse.json({
    summary: { failed_24h: failed.length, succeeded_24h: succeeded, active_sessions: sessions, blocked: blocks.length, locked: locked.length },
    top_ips: top(failed.map(f => ({ key: f.ip_address }))),
    top_accounts: top(failed.map(f => ({ key: f.email }))),
    events: events.map(e => ({ id: e.id, type: e.type, severity: e.severity, ip: e.ip, email: e.email, detail: e.detail ? JSON.parse(e.detail) : null, at: e.created_at })),
    blocks: blocks.map(b => ({ id: b.id, ip: b.ip, reason: b.reason, source: b.source, expires_at: b.expires_at, created_at: b.created_at })),
    locked,
    // who can log in how: an authenticator app (2FA) and/or passkeys. Nobody without either can use a password login while 2FA is required.
    people: people.map(p => ({ id: p.id, name: p.name, email: p.email, mfa: !!p.totp_enabled_at, passkeys: p._count.passkey_credentials })),
    recent_logins: recent.map(l => ({ ...serializeLogin(l), email: l.email, name: l.user?.name ?? null })),
  });
}
