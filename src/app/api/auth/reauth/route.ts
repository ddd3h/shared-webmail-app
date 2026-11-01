import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { reauthenticate } from '@/lib/mfa-manage';
import { recordSecurityEvent } from '@/lib/security-events';

// POST /api/auth/reauth { password, code? } - "prove it again": the password (and the current code, when a second factor is set) of the person who is
// logged in. It makes this session count as recently proved, so the high-risk actions (see lib/reauth.ts) may be done for the next few minutes.
// Wrong answers are limited (5 per 15 minutes), and noted.
export async function POST(req: NextRequest) {
  const r = await reauthenticate(req, { needCode: true });
  if (r instanceof NextResponse) {
    if (r.status === 400) await recordSecurityEvent({ type: 'reauth_failed', severity: 'warn', detail: { reason: r.headers.get('x-reason') ?? 'wrong' } }).catch(() => {});
    return r;
  }
  await prisma.sessions.update({ where: { id: r.session.sessionId }, data: { reauth_at: new Date() } });
  await logAudit({ actorUserId: r.user.id, actionType: 'reauth_success', targetType: 'users', targetId: r.user.id });
  return NextResponse.json({ ok: true });
}
