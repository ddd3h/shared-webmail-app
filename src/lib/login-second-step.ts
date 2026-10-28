// After the password was right: either the login is finished (the 2FA rule is off, or this browser is trusted),
// or the person is sent on to the second step. No session exists until that second step is done.
import { NextRequest, NextResponse } from 'next/server';
import type { IpInfo } from '@/lib/ip-lookup';
import { DEVICE_COOKIE, isTrustedForMfa } from '@/lib/known-device';
import { finishLogin, type Who } from '@/lib/login-flow';
import { hasTotp } from '@/lib/mfa';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { sealShort } from '@/lib/short-token';

type Candidate = Who & { totp_secret_enc: string | null; totp_enabled_at: Date | null };

export async function continueAfterPassword(req: NextRequest, user: Candidate, ctx: { ip: string; ipInfo: IpInfo | null }): Promise<NextResponse> {
  const who: Who = { id: user.id, email: user.email, role: user.role };
  const policy = await loadSecurityPolicy();
  if (!policy.require2fa) return finishLogin(req, who, { method: 'password', ...ctx });

  if (!hasTotp(user)) {
    // first time: set the authenticator app up now, as part of this login
    return NextResponse.json({ mfa_setup_required: true, challenge: await sealShort('mfa-setup-login', { userId: user.id }) });
  }
  if (await isTrustedForMfa(req.cookies.get(DEVICE_COOKIE)?.value, user.id)) return finishLogin(req, who, { method: 'password', ...ctx });
  return NextResponse.json({ mfa_required: true, challenge: await sealShort('mfa-login', { userId: user.id }), trust_days: policy.mfaTrustDays });
}
