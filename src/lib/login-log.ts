import { prisma } from '@/lib/db';

export async function logLoginAttempt(params: {
  userId?: string | null;
  email: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  failureReason?: string | null;
  networkType?: string | null;
  orgName?: string | null;
  country?: string | null;
  city?: string | null;
}): Promise<void> {
  try {
    await prisma.login_logs.create({
      data: {
        user_id: params.userId ?? null,
        email: params.email,
        ip_address: params.ipAddress,
        user_agent: params.userAgent || null,
        success: params.success,
        failure_reason: params.failureReason ?? null,
        network_type: params.networkType ?? null,
        org_name: params.orgName ?? null,
        country: params.country ?? null,
        city: params.city ?? null,
      },
    });
  } catch (e) {
    console.error('[login-log] failed to write login_log', e);
  }
}
