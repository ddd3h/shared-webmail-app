import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { mfaStatus } from '@/lib/mfa';
import { loadSecurityPolicy } from '@/lib/security-settings';

// GET /api/security/mfa - is my second factor on, how many recovery codes are left, and is it required
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const [status, policy] = await Promise.all([mfaStatus(session.userId), loadSecurityPolicy()]);
  return NextResponse.json({ ...status, required: policy.require2fa, trust_days: policy.mfaTrustDays });
}
