import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { createRecoveryCodes, hasTotp } from '@/lib/mfa';
import { fail, reauthenticate } from '@/lib/mfa-manage';
import { notifyMfaChanged } from '@/lib/work-notify';

// POST /api/security/mfa/recovery-codes { password, code } - a new set of 10 (the old ones stop working)
export async function POST(req: NextRequest) {
  const r = await reauthenticate(req, { needCode: true });
  if (r instanceof NextResponse) return r;
  if (!hasTotp(r.user)) return fail('mfa_not_enabled', 409, '先に2段階認証を設定してください');
  const codes = await createRecoveryCodes(r.user.id);
  await logAudit({ actorUserId: r.user.id, actionType: 'mfa_recovery_regenerate', targetType: 'users', targetId: r.user.id });
  void notifyMfaChanged(r.user.id, 'codes_regenerated');
  return NextResponse.json({ ok: true, recovery_codes: codes });
}
