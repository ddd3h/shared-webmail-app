import { NextRequest, NextResponse } from 'next/server';
import { revokeUserSessions } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { clearTotp } from '@/lib/mfa';
import { reauthenticate } from '@/lib/mfa-manage';
import { recordSecurityEvent } from '@/lib/security-events';
import { notifyMfaChanged } from '@/lib/work-notify';

// POST /api/security/mfa/disable { password, code } - turn it off. Needs the password and a current code.
// Other devices are logged out, and with the rule on, a password login has to set a new factor up again.
export async function POST(req: NextRequest) {
  const r = await reauthenticate(req, { needCode: true });
  if (r instanceof NextResponse) return r;
  await clearTotp(r.user.id);
  await revokeUserSessions(r.user.id, r.session.sessionId);
  await logAudit({ actorUserId: r.user.id, actionType: 'mfa_disabled', targetType: 'users', targetId: r.user.id });
  await recordSecurityEvent({ type: 'mfa_disabled', severity: 'warn', userId: r.user.id, email: r.user.email });
  void notifyMfaChanged(r.user.id, 'disabled');
  return NextResponse.json({ ok: true });
}
